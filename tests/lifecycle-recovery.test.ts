// Price env is read lazily inside planNameForPrice — stub before any call.
process.env.STRIPE_PRICE_PRO_MONTHLY ??= "price_monthly_test";
process.env.STRIPE_PRICE_PRO_YEARLY ??= "price_yearly_test";
process.env.EMAIL_UNSUBSCRIBE_SECRET ??= "test-unsubscribe-secret";
process.env.NEXT_PUBLIC_APP_URL ??= "https://mellowa.app";

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adoptSubscriptionForCustomer } from "@/lib/stripe/reconcile";
import { classifyRpcProbe } from "@/lib/health";
import {
  isUnsubscribeCategory,
  unsubscribeToken,
  unsubscribeUrl,
  verifyUnsubscribeToken,
} from "@/lib/email/unsubscribe";

/**
 * MW-V10-00 — recovery paths for the three failure modes that unit contracts
 * previously could not see, because each one is a *missing* mechanism rather
 * than a wrong value:
 *
 *   1. paid but no access — the webhook never landed and reconciliation was
 *      structurally blind to the affected rows;
 *   2. reminder email with no working opt-out;
 *   3. email confirmation that only works on the signup device.
 *
 * Each test below fails against the pre-fix code.
 */

// ---------------------------------------------------------------------------
// 1. Paid but no access
// ---------------------------------------------------------------------------

function fakeStripe(subs: unknown[]) {
  return {
    subscriptions: {
      list: async () => ({ data: subs }),
    },
  } as never;
}

function fakeAdmin(captured: { row?: Record<string, unknown> }) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: null }),
    upsert: async (row: Record<string, unknown>) => {
      captured.row = row;
      return { error: null };
    },
  };
  return { from: () => builder } as never;
}

const stripeSubscription = (overrides: Record<string, unknown> = {}) => ({
  id: "sub_live",
  status: "active",
  cancel_at_period_end: false,
  trial_start: null,
  trial_end: null,
  items: {
    data: [{ price: { id: "price_monthly_test" }, current_period_end: 1800000000 }],
  },
  ...overrides,
});

describe("paid-but-no-access recovery", () => {
  it("adopts the live Stripe subscription when the webhook never landed", async () => {
    const captured: { row?: Record<string, unknown> } = {};
    const result = await adoptSubscriptionForCustomer(
      fakeStripe([stripeSubscription()]),
      fakeAdmin(captured),
      "user-1",
      "cus_1"
    );

    expect(result).toEqual({ subscriptionId: "sub_live", status: "active" });
    // The row must now carry the subscription id and an entitling status,
    // otherwise the user stays locked out of what they paid for.
    expect(captured.row?.stripe_subscription_id).toBe("sub_live");
    expect(captured.row?.status).toBe("active");
    expect(captured.row?.plan_name).toBe("pro_monthly");
  });

  it("prefers an access-granting subscription over an older canceled one", async () => {
    const captured: { row?: Record<string, unknown> } = {};
    await adoptSubscriptionForCustomer(
      fakeStripe([
        stripeSubscription({ id: "sub_old", status: "canceled" }),
        stripeSubscription({ id: "sub_new", status: "trialing" }),
      ]),
      fakeAdmin(captured),
      "user-1",
      "cus_1"
    );
    expect(captured.row?.stripe_subscription_id).toBe("sub_new");
  });

  it("does nothing when the customer genuinely has no subscription", async () => {
    const captured: { row?: Record<string, unknown> } = {};
    const result = await adoptSubscriptionForCustomer(
      fakeStripe([]),
      fakeAdmin(captured),
      "user-1",
      "cus_1"
    );
    expect(result).toBeNull();
    expect(captured.row).toBeUndefined();
  });

  it("refuses to guess a plan for an unknown price", async () => {
    await expect(
      adoptSubscriptionForCustomer(
        fakeStripe([
          stripeSubscription({
            items: { data: [{ price: { id: "price_unknown" } }] },
          }),
        ]),
        fakeAdmin({}),
        "user-1",
        "cus_1"
      )
    ).rejects.toThrow(/unknown Stripe price/);
  });

  it("reconciliation sweeps rows with no subscription id", () => {
    // The blind spot was structural: the drift walk only selected rows that
    // already had an id, which is exactly the set that cannot be broken.
    const source = readFileSync("src/lib/stripe/reconcile.ts", "utf8");
    expect(source).toMatch(/\.is\("stripe_subscription_id", null\)/);
    expect(source).toContain("adoptedSubscriptions");
  });
});

// ---------------------------------------------------------------------------
// 2. Reminder opt-out
// ---------------------------------------------------------------------------

describe("reminder unsubscribe", () => {
  it("round-trips a signed token", () => {
    const token = unsubscribeToken("user-1", "daily_reminder");
    expect(token).toBeTruthy();
    expect(verifyUnsubscribeToken("user-1", "daily_reminder", token!)).toBe(true);
  });

  it("rejects a tampered user, category or token", () => {
    const token = unsubscribeToken("user-1", "daily_reminder")!;
    expect(verifyUnsubscribeToken("user-2", "daily_reminder", token)).toBe(false);
    expect(verifyUnsubscribeToken("user-1", "onboarding_nudge", token)).toBe(false);
    expect(verifyUnsubscribeToken("user-1", "daily_reminder", "forged")).toBe(false);
    expect(verifyUnsubscribeToken("user-1", "daily_reminder", "")).toBe(false);
  });

  it("builds an absolute URL carrying no personal data beyond the id", () => {
    const url = unsubscribeUrl("user-1", "daily_reminder")!;
    expect(url.startsWith("https://")).toBe(true);
    expect(url).toContain("/api/email/unsubscribe");
    expect(url).toContain("c=daily_reminder");
  });

  it("only reminder categories are unsubscribable — billing mail is not", () => {
    expect(isUnsubscribeCategory("daily_reminder")).toBe(true);
    expect(isUnsubscribeCategory("onboarding_nudge")).toBe(true);
    for (const transactional of [
      "payment_failed",
      "trial_started",
      "canceled",
      "welcome",
    ]) {
      expect(isUnsubscribeCategory(transactional)).toBe(false);
    }
  });

  it("the unsubscribe endpoint answers a signed-out one-click POST", () => {
    const route = readFileSync("src/app/api/email/unsubscribe/route.ts", "utf8");
    // RFC 8058: mail clients POST without any user interaction, so a
    // GET-only or auth-gated handler is not a working opt-out.
    expect(route).toMatch(/export async function POST/);
    expect(route).toMatch(/export async function GET/);
    expect(route).not.toContain("requireUser");
  });

  it("reminder mail ships a real link and one-click headers", () => {
    const cron = readFileSync(
      "src/app/api/cron/daily-reminders/route.ts",
      "utf8"
    );
    expect(cron).toContain("unsubscribeUrl");
    // The old copy promised an opt-out in Settings without linking anywhere.
    expect(cron).toMatch(/href="\$\{optOut\}"/);

    const send = readFileSync("src/lib/email/send.ts", "utf8");
    expect(send).toContain("List-Unsubscribe");
    expect(send).toContain("List-Unsubscribe-Post");
  });
});

// ---------------------------------------------------------------------------
// 3. Cross-device email confirmation
// ---------------------------------------------------------------------------

describe("email confirmation", () => {
  const callback = readFileSync("src/app/auth/callback/route.ts", "utf8");

  it("accepts the device-independent token_hash link", () => {
    // PKCE code exchange needs the verifier cookie from the signup browser, so
    // opening the confirmation mail on a phone would otherwise read as expired.
    expect(callback).toContain("token_hash");
    expect(callback).toContain("verifyOtp");
  });

  it("still supports the PKCE code link", () => {
    expect(callback).toContain("exchangeCodeForSession");
  });

  it("sends recovery links to the password form, not into the app", () => {
    expect(callback).toMatch(/recovery/);
    expect(callback).toContain("/reset-password");
  });
});

// ---------------------------------------------------------------------------
// 4. Readiness proves the RPC overloads the app actually calls
// ---------------------------------------------------------------------------

describe("readiness RPC probes", () => {
  it("treats a missing function as a failure", () => {
    // PostgREST reports an absent overload as PGRST202. That is precisely the
    // deploy-time state that would otherwise surface as a 500 on a user's
    // first generation.
    expect(classifyRpcProbe({ code: "PGRST202" })).toBe("fail");
    expect(
      classifyRpcProbe({ message: "Could not find the function public.foo" })
    ).toBe("fail");
  });

  it("treats an argument-coercion error as proof the overload exists", () => {
    // 22P02 means the signature resolved and Postgres got as far as parsing
    // the uuid — the body never ran, so the probe has no side effects.
    expect(classifyRpcProbe({ code: "22P02" })).toBe("ok");
    expect(classifyRpcProbe(null)).toBe("ok");
  });

  it("readiness checks both v9 overloads by name", () => {
    const route = readFileSync("src/app/api/health/ready/route.ts", "utf8");
    expect(route).toContain("claim_ai_generation");
    expect(route).toContain("undo_plan_repair");
    // Seven-argument fair-use overload, not the older five-argument one.
    expect(route).toContain("p_global_daily_ceiling");
    expect(route).toContain("p_expected_version");
  });
});
