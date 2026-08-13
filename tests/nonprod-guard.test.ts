import { execFileSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  GuardError,
  parseSupabaseProjectRef,
  decodeSupabaseKeyClaims,
  evaluateStripeKey,
  findLiveStripeIds,
  evaluateNonProduction,
  evaluateSeedMarker,
  resolveCleanupLease,
  computeTeardownActions,
} from "../scripts/nonprod-guard.mjs";

/**
 * MW-V18-03: the non-production guard must decide by PROJECT IDENTITY, never by
 * the presence/absence of a scary substring. These prove the acceptance
 * criterion: no RC path can touch production merely because the production ref
 * lacks a readable name.
 */

const APPROVED = "abcdefghijklmnopqrst"; // 20-char disposable ref
const PROD = "zyxwvutsrqponmlkjihg"; // 20-char opaque production ref (no "prod")

/** Mint a structurally valid (unsigned) Supabase JWT with chosen claims. */
function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(claims)}.SIGNATUREREDACTED`;
}

function baseEnv(over: Record<string, string> = {}): Record<string, string> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: `https://${APPROVED}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ ref: APPROVED, role: "anon" }),
    SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: APPROVED, role: "service_role" }),
    STRIPE_SECRET_KEY: "sk_test_deadbeef",
    E2E_SUPABASE_PROJECT_REF: APPROVED,
    E2E_SUPABASE_ALLOWED_REFS: APPROVED,
    PRODUCTION_SUPABASE_PROJECT_REF: PROD,
    ...over,
  };
}

describe("parseSupabaseProjectRef", () => {
  it("extracts the ref from a canonical Supabase host", () => {
    expect(parseSupabaseProjectRef(`https://${APPROVED}.supabase.co`).ref).toBe(APPROVED);
  });
  it("rejects a malformed URL", () => {
    expect(() => parseSupabaseProjectRef("not a url")).toThrow(GuardError);
  });
  it("rejects a custom domain unless explicitly allowlisted", () => {
    expect(() => parseSupabaseProjectRef("https://db.mycompany.com")).toThrow(GuardError);
    expect(
      parseSupabaseProjectRef("https://db.mycompany.com", { allowedHosts: ["db.mycompany.com"] }).ref
    ).toBe("host:db.mycompany.com");
  });
  it("rejects a non-https Supabase host", () => {
    expect(() => parseSupabaseProjectRef(`http://${APPROVED}.supabase.co`)).toThrow(GuardError);
  });
});

describe("decodeSupabaseKeyClaims exposes only ref + role", () => {
  it("returns the ref and role, never the whole payload", () => {
    const claims = decodeSupabaseKeyClaims(jwt({ ref: APPROVED, role: "anon", secret_marker: "X" }));
    expect(claims).toEqual({ ref: APPROVED, role: "anon" });
  });
  it("returns null for a non-JWT value", () => {
    expect(decodeSupabaseKeyClaims("sb_secret_notajwt")).toBeNull();
  });
});

describe("evaluateStripeKey", () => {
  it("accepts a test key", () => {
    expect(evaluateStripeKey("sk_test_x")).toMatchObject({ ok: true, mode: "test" });
  });
  it("refuses a live key", () => {
    const r = evaluateStripeKey("sk_live_x");
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toMatch(/LIVE key/);
  });
  it("refuses a malformed key", () => {
    const r = evaluateStripeKey("pk_test_wrongtype");
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toMatch(/TEST key/);
  });
});

describe("evaluateNonProduction — identity, not substrings", () => {
  it("passes for an allowlisted disposable ref with matching credentials", () => {
    const r = evaluateNonProduction(baseEnv());
    expect(r.ok).toBe(true);
    expect(r.ref).toBe(APPROVED);
  });

  it("passes even though the production ref is opaque (no readable name)", () => {
    // The acceptance criterion: an opaque production ref must not weaken safety.
    expect(PROD).not.toMatch(/prod/);
    const r = evaluateNonProduction(baseEnv());
    expect(r.ok).toBe(true);
  });

  it("BLOCKS when the target ref equals the production ref", () => {
    const r = evaluateNonProduction(
      baseEnv({
        NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co`,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ ref: PROD, role: "anon" }),
        SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: PROD, role: "service_role" }),
        E2E_SUPABASE_PROJECT_REF: PROD,
        E2E_SUPABASE_ALLOWED_REFS: PROD,
      })
    );
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toMatch(/equals PRODUCTION_SUPABASE_PROJECT_REF/);
  });

  it("BLOCKS a malformed Supabase URL", () => {
    const r = evaluateNonProduction(baseEnv({ NEXT_PUBLIC_SUPABASE_URL: "not a url" }));
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toMatch(/not a valid URL/);
  });

  it("BLOCKS an un-allowlisted custom domain", () => {
    const r = evaluateNonProduction(baseEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://db.mycompany.com" }));
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toMatch(/not a recognised Supabase host/);
  });

  it("BLOCKS an empty allowlist", () => {
    const r = evaluateNonProduction(baseEnv({ E2E_SUPABASE_ALLOWED_REFS: "" }));
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toMatch(/non-empty allowlist/);
  });

  it("BLOCKS mismatched credentials (anon key from another project)", () => {
    const r = evaluateNonProduction(
      baseEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ ref: "otherotherotherother", role: "anon" }) })
    );
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY belongs to project/);
  });

  it("BLOCKS a service key carrying the wrong role", () => {
    const r = evaluateNonProduction(
      baseEnv({ SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: APPROVED, role: "anon" }) })
    );
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toMatch(/role "anon", expected "service_role"/);
  });

  it("BLOCKS a live Stripe key", () => {
    const r = evaluateNonProduction(baseEnv({ STRIPE_SECRET_KEY: "sk_live_x" }));
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toMatch(/LIVE key/);
  });

  it("BLOCKS a malformed Stripe key", () => {
    const r = evaluateNonProduction(baseEnv({ STRIPE_SECRET_KEY: "totally-wrong" }));
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toMatch(/TEST key/);
  });

  it("BLOCKS when the production ref is inside the allowlist", () => {
    const r = evaluateNonProduction(baseEnv({ E2E_SUPABASE_ALLOWED_REFS: `${APPROVED},${PROD}` }));
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toMatch(/must not appear in E2E_SUPABASE_ALLOWED_REFS/);
  });

  it("flags a live-mode Stripe id leaking into fixtures", () => {
    // e.g. a live key/id mistakenly pasted into a fixture price var.
    expect(findLiveStripeIds({ STRIPE_PRICE_PRO_MONTHLY: "sk_live_abc" })).toEqual([
      "STRIPE_PRICE_PRO_MONTHLY",
    ]);
  });
});

describe("evaluateSeedMarker (second defence)", () => {
  it("fails closed on a missing marker", () => {
    expect(evaluateSeedMarker({ marker: null }).ok).toBe(false);
  });
  it("fails closed on a read error", () => {
    expect(evaluateSeedMarker({ error: { message: "relation does not exist" } }).ok).toBe(false);
  });
  it("passes only with a present marker row", () => {
    expect(evaluateSeedMarker({ marker: { note: "NOT production" } }).ok).toBe(true);
  });
});

describe("cleanup lease + idempotent teardown", () => {
  it("resolves a deterministic namespace per run", () => {
    expect(resolveCleanupLease({ GITHUB_RUN_ID: "999" })).toEqual({
      leaseId: "999",
      namespace: "mellowa-e2e/999",
    });
    expect(resolveCleanupLease({}).leaseId).toBe("local");
  });
  it("is a safe no-op when retried after everything was deleted", () => {
    const first = computeTeardownActions([{ id: "a" }, { id: "a" }, { id: "b" }]);
    expect(first).toEqual({ deleteIds: ["a", "b"], done: false });
    const retry = computeTeardownActions([]); // rows already gone
    expect(retry).toEqual({ deleteIds: [], done: true });
  });
});

describe("secret redaction — the CLI never prints key values or JWT payloads", () => {
  it("prints only names + the opaque ref, never secrets", () => {
    const env = {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: `https://${APPROVED}.supabase.co`,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ ref: APPROVED, role: "anon", secret_marker: "ANON_SECRET_XYZ" }),
      SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: APPROVED, role: "service_role", secret_marker: "SVC_SECRET_XYZ" }),
      STRIPE_SECRET_KEY: "sk_test_STRIPE_SECRET_XYZ",
      E2E_SUPABASE_PROJECT_REF: APPROVED,
      E2E_SUPABASE_ALLOWED_REFS: APPROVED,
      PRODUCTION_SUPABASE_PROJECT_REF: PROD,
    };
    let output = "";
    try {
      output = execFileSync("node", ["scripts/nonprod-guard.mjs"], { encoding: "utf8", env });
    } catch (e: unknown) {
      const err = e as { stdout?: string; stderr?: string };
      output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    }
    // The opaque ref is allowed; secret material is not.
    expect(output).toContain(APPROVED);
    for (const secret of [
      "ANON_SECRET_XYZ",
      "SVC_SECRET_XYZ",
      "STRIPE_SECRET_XYZ",
      "sk_test_STRIPE_SECRET_XYZ",
      "SIGNATUREREDACTED",
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      env.SUPABASE_SERVICE_ROLE_KEY,
    ]) {
      expect(output).not.toContain(secret);
    }
  });
});
