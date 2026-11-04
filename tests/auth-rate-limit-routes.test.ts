import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Request-flood protection for the public auth endpoints. Signup, password
 * reset and resend-verification run server-side behind a durable limiter
 * (claim_auth_rate_limit RPC, migration 055), with a honeypot, hashed buckets
 * (no raw email/IP), fail-closed 503 when the limiter is unavailable, and the
 * existing non-enumerating responses.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ fn: string; args: Row }>,
  // Sequence of results the RPC returns, one per call (default: allowed).
  rpcResults: [] as Array<{ data: unknown; error: Row | null }>,
  adminThrows: false,
  signUpCalls: [] as Row[],
  signUpResult: { data: { session: null, user: { id: "new" } }, error: null } as {
    data: { session: unknown; user: unknown };
    error: { message: string; status?: number; code?: string } | null;
  },
  resetCalls: [] as Array<{ email: string; opts: Row }>,
  resetError: null as Row | null,
  resendCalls: [] as Row[],
  resendError: null as Row | null,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (h.adminThrows) throw new Error("Missing required environment variable");
    return {
      rpc: async (fn: string, args: Row) => {
        h.rpcCalls.push({ fn, args });
        return h.rpcResults.shift() ?? { data: 0, error: null };
      },
    };
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signUp: async (args: Row) => {
        h.signUpCalls.push(args);
        return h.signUpResult;
      },
      resetPasswordForEmail: async (email: string, opts: Row) => {
        h.resetCalls.push({ email, opts });
        return { data: {}, error: h.resetError };
      },
      resend: async (args: Row) => {
        h.resendCalls.push(args);
        return { data: {}, error: h.resendError };
      },
    },
  }),
}));

import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as passwordReset } from "@/app/api/auth/password-reset/route";
import { POST as resendVerification } from "@/app/api/auth/resend-verification/route";
import { AUTH_RATE_LIMITS, clientIp } from "@/lib/auth/rate-limit";
import { HONEYPOT_FIELD, honeypotTripped } from "@/lib/auth/honeypot";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const EMAIL = "  Person@Example.COM ";
const NORMALIZED = "person@example.com";
const IP = "203.0.113.7";

function req(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://mellowa.app${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `${IP}, 10.0.0.1`, ...headers },
    body: JSON.stringify(body),
  });
}

const SIGNUP = {
  email: EMAIL,
  password: "longenoughpassword",
  age18: true,
  policies: true,
  healthData: true,
  plan: "monthly",
  next: null,
  [HONEYPOT_FIELD]: "",
};

beforeEach(() => {
  h.rpcCalls = [];
  h.rpcResults = [];
  h.adminThrows = false;
  h.signUpCalls = [];
  h.signUpResult = { data: { session: null, user: { id: "new" } }, error: null };
  h.resetCalls = [];
  h.resetError = null;
  h.resendCalls = [];
  h.resendError = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("limits contract", () => {
  it("matches the owner's numbers", () => {
    expect(AUTH_RATE_LIMITS.signupIp).toEqual({ prefix: "signup_ip", limit: 5, windowSeconds: 3600 });
    expect(AUTH_RATE_LIMITS.signupEmail).toEqual({ prefix: "signup_email", limit: 3, windowSeconds: 86400 });
    expect(AUTH_RATE_LIMITS.resetEmail).toEqual({ prefix: "reset_email", limit: 3, windowSeconds: 3600 });
    expect(AUTH_RATE_LIMITS.resendEmail).toEqual({ prefix: "resend_email", limit: 3, windowSeconds: 3600 });
  });

  it("reads the client IP from x-forwarded-for (first entry), then x-real-ip", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": " 198.51.100.1 , 10.0.0.1" }))).toBe("198.51.100.1");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(new Headers())).toBeNull();
  });

  it("the honeypot trips only when filled", () => {
    expect(honeypotTripped({ [HONEYPOT_FIELD]: "" })).toBe(false);
    expect(honeypotTripped({ [HONEYPOT_FIELD]: "   " })).toBe(false);
    expect(honeypotTripped({})).toBe(false);
    expect(honeypotTripped({ [HONEYPOT_FIELD]: "https://spam.example" })).toBe(true);
  });
});

describe("POST /api/auth/signup", () => {
  it("claims hashed IP + email buckets, then signs up with the unchanged metadata and redirect", async () => {
    const res = await signup(req("/api/auth/signup", SIGNUP));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, next: "verify_email" });

    expect(h.rpcCalls).toEqual([
      {
        fn: "claim_auth_rate_limit",
        args: { p_bucket: `signup_ip:${sha(IP)}`, p_limit: 5, p_window_seconds: 3600 },
      },
      {
        fn: "claim_auth_rate_limit",
        args: { p_bucket: `signup_email:${sha(NORMALIZED)}`, p_limit: 3, p_window_seconds: 86400 },
      },
    ]);
    for (const { args } of h.rpcCalls) {
      const bucket = String(args.p_bucket);
      expect(bucket).toMatch(/^[a-z_]+:[0-9a-f]{64}$/);
      expect(bucket.toLowerCase()).not.toContain("example.com");
      expect(bucket).not.toContain(IP);
    }

    expect(h.signUpCalls).toEqual([
      {
        email: "Person@Example.COM",
        password: "longenoughpassword",
        options: {
          emailRedirectTo: "https://mellowa.app/auth/callback?plan=monthly",
          data: { age_18_plus: true, terms_and_privacy: true, health_data: true },
        },
      },
    ]);
  });

  it("429 with Retry-After at the per-IP limit; nothing else is claimed and no account is created", async () => {
    h.rpcResults = [{ data: 1200, error: null }];
    const res = await signup(req("/api/auth/signup", SIGNUP));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("1200");
    const body = await res.json();
    expect(body.error).toBe("rate_limited");
    expect(body.user_message).toMatch(/try again/i);
    expect(h.rpcCalls).toHaveLength(1);
    expect(h.signUpCalls).toEqual([]);
  });

  it("429 at the per-address limit", async () => {
    h.rpcResults = [
      { data: 0, error: null },
      { data: 40000, error: null },
    ];
    const res = await signup(req("/api/auth/signup", SIGNUP));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("40000");
    expect(h.signUpCalls).toEqual([]);
  });

  it("a filled honeypot gets the exact generic success, and nothing is claimed or created", async () => {
    const real = await (await signup(req("/api/auth/signup", SIGNUP))).json();
    h.rpcCalls = [];
    h.signUpCalls = [];
    const res = await signup(req("/api/auth/signup", { ...SIGNUP, [HONEYPOT_FIELD]: "https://spam.example" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(real);
    expect(h.rpcCalls).toEqual([]);
    expect(h.signUpCalls).toEqual([]);
  });

  it("fails closed with a calm 503 when the limiter RPC errors (or cannot be reached)", async () => {
    h.rpcResults = [{ data: null, error: { code: "42883", message: "function does not exist" } }];
    const res = await signup(req("/api/auth/signup", SIGNUP));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("unavailable");
    expect(body.user_message).toMatch(/try again shortly/i);
    expect(JSON.stringify(body)).not.toContain("function does not exist");
    expect(h.signUpCalls).toEqual([]);

    h.adminThrows = true;
    expect((await signup(req("/api/auth/signup", SIGNUP))).status).toBe(503);
    expect(h.signUpCalls).toEqual([]);
  });

  it("an unexpected limiter result also fails closed", async () => {
    h.rpcResults = [{ data: "nonsense", error: null }];
    expect((await signup(req("/api/auth/signup", SIGNUP))).status).toBe(503);
    expect(h.signUpCalls).toEqual([]);
  });

  it("all three consents are required server-side; missing one creates nothing", async () => {
    const res = await signup(req("/api/auth/signup", { ...SIGNUP, healthData: false }));
    expect(res.status).toBe(400);
    expect(h.rpcCalls).toEqual([]);
    expect(h.signUpCalls).toEqual([]);
  });

  it("maps the beta gate, keeps an existing address non-enumerating, and reports a live session", async () => {
    h.signUpResult = { data: { session: null, user: null }, error: { message: "Database error: beta_signups_closed" } };
    let res = await signup(req("/api/auth/signup", SIGNUP));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("beta_closed");

    h.signUpResult = { data: { session: null, user: null }, error: { message: "User already registered" } };
    res = await signup(req("/api/auth/signup", SIGNUP));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, next: "verify_email" });

    h.signUpResult = { data: { session: { access_token: "t" }, user: { id: "u" } }, error: null };
    res = await signup(req("/api/auth/signup", SIGNUP));
    expect(await res.json()).toEqual({ ok: true, next: "session" });
  });

  it("drops an unsafe next path from the callback link", async () => {
    await signup(req("/api/auth/signup", { ...SIGNUP, plan: null, next: "https://evil.example/x" }));
    expect((h.signUpCalls[0].options as Row).emailRedirectTo).toBe("https://mellowa.app/auth/callback");
  });
});

describe("POST /api/auth/password-reset", () => {
  it("claims the hashed per-address bucket and answers generically", async () => {
    const res = await passwordReset(req("/api/auth/password-reset", { email: EMAIL }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.rpcCalls).toEqual([
      {
        fn: "claim_auth_rate_limit",
        args: { p_bucket: `reset_email:${sha(NORMALIZED)}`, p_limit: 3, p_window_seconds: 3600 },
      },
    ]);
    expect(h.resetCalls).toEqual([
      { email: "Person@Example.COM", opts: { redirectTo: "https://mellowa.app/reset-password" } },
    ]);
  });

  it("never reveals whether the account exists: a provider error gets the same response", async () => {
    const ok = await (await passwordReset(req("/api/auth/password-reset", { email: EMAIL }))).json();
    h.resetError = { message: "User not found", status: 400 };
    const res = await passwordReset(req("/api/auth/password-reset", { email: "nobody@example.com" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(ok);
  });

  it("429 + Retry-After at the limit, nothing sent; 503 when the limiter fails", async () => {
    h.rpcResults = [{ data: 1800, error: null }];
    const limited = await passwordReset(req("/api/auth/password-reset", { email: EMAIL }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("1800");
    expect(h.resetCalls).toEqual([]);

    h.rpcResults = [{ data: null, error: { code: "PGRST" } }];
    const down = await passwordReset(req("/api/auth/password-reset", { email: EMAIL }));
    expect(down.status).toBe(503);
    expect(h.resetCalls).toEqual([]);
  });

  it("a filled honeypot gets the generic response and nothing is claimed or sent", async () => {
    const res = await passwordReset(req("/api/auth/password-reset", { email: EMAIL, [HONEYPOT_FIELD]: "x" }));
    expect(await res.json()).toEqual({ ok: true });
    expect(h.rpcCalls).toEqual([]);
    expect(h.resetCalls).toEqual([]);
  });
});

describe("POST /api/auth/resend-verification", () => {
  it("claims the hashed per-address bucket and carries the sanitized intent", async () => {
    const res = await resendVerification(
      req("/api/auth/resend-verification", { email: EMAIL, plan: "yearly", next: "/today" })
    );
    expect(await res.json()).toEqual({ ok: true });
    expect(h.rpcCalls[0].args).toEqual({
      p_bucket: `resend_email:${sha(NORMALIZED)}`,
      p_limit: 3,
      p_window_seconds: 3600,
    });
    expect(h.resendCalls).toEqual([
      {
        type: "signup",
        email: "Person@Example.COM",
        options: { emailRedirectTo: "https://mellowa.app/auth/callback?plan=yearly&next=%2Ftoday" },
      },
    ]);
  });

  it("is non-enumerating, limited (429 + Retry-After) and fails closed (503)", async () => {
    h.resendError = { message: "Email not found", status: 400 };
    expect(await (await resendVerification(req("/api/auth/resend-verification", { email: EMAIL }))).json()).toEqual({
      ok: true,
    });

    h.resendCalls = [];
    h.rpcResults = [{ data: 3599, error: null }];
    const limited = await resendVerification(req("/api/auth/resend-verification", { email: EMAIL }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("3599");
    expect(h.resendCalls).toEqual([]);

    h.rpcResults = [{ data: null, error: { code: "XX000" } }];
    expect((await resendVerification(req("/api/auth/resend-verification", { email: EMAIL }))).status).toBe(503);
    expect(h.resendCalls).toEqual([]);
  });
});

describe("the browser forms no longer call Supabase auth directly for these flows", () => {
  const authForm = readFileSync("src/components/forms/auth-form.tsx", "utf8");
  const forgot = readFileSync("src/components/forms/forgot-password-form.tsx", "utf8");
  const verify = readFileSync("src/components/forms/verify-email-card.tsx", "utf8");

  it("uses the server routes", () => {
    expect(authForm).not.toContain("auth.signUp(");
    expect(authForm).toContain('fetch("/api/auth/signup"');
    expect(forgot).not.toContain("resetPasswordForEmail");
    expect(forgot).toContain('fetch("/api/auth/password-reset"');
    expect(verify).not.toContain("auth.resend(");
    expect(verify).toContain('fetch("/api/auth/resend-verification"');
  });

  it("renders the honeypot off-screen (not display:none), aria-hidden, untabbable, autocomplete off", () => {
    for (const src of [authForm, forgot]) {
      expect(src).toContain("register(HONEYPOT_FIELD)");
      expect(src).toContain('aria-hidden="true"');
      expect(src).toContain("tabIndex={-1}");
      expect(src).toContain('autoComplete="off"');
      expect(src).toContain("-left-[10000px]");
      // 44px tall so the public-page touch-target check (e2e) still holds.
      expect(src).toMatch(/className="h-11"/);
    }
    expect(authForm).not.toMatch(/company_website[\s\S]{0,200}display:\s*none/);
  });
});
