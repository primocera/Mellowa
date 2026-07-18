// Price env is read lazily inside planNameForPrice — stub before any call.
process.env.STRIPE_PRICE_PRO_MONTHLY ??= "price_monthly_test";
process.env.STRIPE_PRICE_PRO_YEARLY ??= "price_yearly_test";

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  diffSubscription,
  findDuplicateCustomers,
  type LocalSubRow,
} from "@/lib/stripe/reconcile";
import { propertiesSchema } from "@/lib/analytics/taxonomy";

/** Billing ops (Launch v6, Prompt 18) — reconciliation + churn contracts. */

const local: LocalSubRow = {
  user_id: "u1",
  stripe_customer_id: "cus_1",
  stripe_subscription_id: "sub_1",
  plan_name: "pro_monthly",
  status: "active",
  current_period_end: "2026-08-01T00:00:00.000Z",
  trial_end: null,
  cancel_at_period_end: false,
};

function stripeSub(overrides: Partial<{
  status: string;
  cancel_at_period_end: boolean;
  trial_end: number | null;
  period_end: number;
  price: string;
}> = {}) {
  return {
    id: "sub_1",
    status: (overrides.status ?? "active") as never,
    cancel_at_period_end: overrides.cancel_at_period_end ?? false,
    trial_end: overrides.trial_end ?? null,
    items: {
      data: [
        {
          price: { id: overrides.price ?? "price_unknown_in_test_env" },
          current_period_end:
            overrides.period_end ?? Date.parse("2026-08-01T00:00:00.000Z") / 1000,
        },
      ],
    },
  };
}

describe("reconciliation drift detection", () => {
  it("reports no drift when states match", () => {
    expect(diffSubscription(local, stripeSub())).toEqual([]);
  });

  it("detects status drift (e.g. missed cancellation webhook)", () => {
    const drift = diffSubscription(local, stripeSub({ status: "canceled" }));
    expect(drift).toEqual([
      { userId: "u1", subscriptionId: "sub_1", field: "status", local: "active", stripe: "canceled" },
    ]);
  });

  it("detects period-end and cancel-flag drift together", () => {
    const drift = diffSubscription(
      local,
      stripeSub({
        cancel_at_period_end: true,
        period_end: Date.parse("2026-09-01T00:00:00.000Z") / 1000,
      })
    );
    expect(drift.map((d) => d.field).sort()).toEqual([
      "cancel_at_period_end",
      "current_period_end",
    ]);
  });

  it("does not flag plan_name when the price is unknown (webhook owns that failure)", () => {
    const drift = diffSubscription(local, stripeSub({ price: "price_nonsense" }));
    expect(drift.find((d) => d.field === "plan_name")).toBeUndefined();
  });

  it("finds duplicate Stripe customers across users", () => {
    expect(
      findDuplicateCustomers([
        { user_id: "u1", stripe_customer_id: "cus_1" },
        { user_id: "u2", stripe_customer_id: "cus_1" },
        { user_id: "u3", stripe_customer_id: "cus_2" },
        { user_id: "u4", stripe_customer_id: null },
      ])
    ).toEqual([{ customerId: "cus_1", userIds: ["u1", "u2"] }]);
  });
});

describe("churn taxonomy", () => {
  it("accepts churn_type and closed cancel reasons, rejects free text", () => {
    expect(
      propertiesSchema.safeParse({ churn_type: "involuntary", cancel_reason: "not_using" }).success
    ).toBe(true);
    expect(propertiesSchema.safeParse({ cancel_reason: "I hate it" }).success).toBe(false);
    expect(propertiesSchema.safeParse({ churn_type: "rage" }).success).toBe(false);
  });
});

describe("cancellation is never gated on a survey", () => {
  it("cancel route treats reason as optional and tags voluntary churn", () => {
    const src = readFileSync("src/app/api/stripe/cancel/route.ts", "utf8");
    expect(src).toMatch(/reason:[\s\S]{0,200}\.optional\(\)/);
    expect(src).toContain('"cancellation_requested"');
  });

  it("webhook distinguishes voluntary from involuntary churn", () => {
    const src = readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");
    expect(src).toContain("churn_type");
    expect(src).toContain('"involuntary"');
  });

  it("reconcile route is secret-gated", () => {
    const src = readFileSync("src/app/api/cron/billing-reconcile/route.ts", "utf8");
    expect(src).toContain("requireBearerSecret");
  });
});
