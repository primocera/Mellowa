import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MW-03: `getUserSubscriptionStatus` must not collapse a failed provider read
 * into a definitive "none". It exposes an explicit `billing` availability so a
 * paying user is never mislabeled Free/Sample, and every generation/premium
 * gate fails closed when billing is `unavailable`.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  subRead: { data: null as Row | null, error: null as Row | null },
  count: 0 as number | null,
  countError: null as Row | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => {
          if (table === "subscriptions") {
            return { maybeSingle: async () => h.subRead };
          }
          if (table === "weekly_plans") {
            return { gte: () => Promise.resolve({ count: h.count, error: h.countError }) };
          }
          return Promise.resolve({ count: h.count, error: h.countError });
        },
      }),
    }),
  }),
}));

import {
  getUserSubscriptionStatus,
  canGenerateWeeklyPlan,
  canUsePremiumFeature,
} from "@/lib/stripe/subscription";

beforeEach(() => {
  h.subRead = { data: null, error: null };
  h.count = 0;
  h.countError = null;
});

describe("getUserSubscriptionStatus surfaces an explicit billing availability", () => {
  it("reports `unavailable` (never premium) when the read errors, with status none", async () => {
    h.subRead = { data: null, error: { code: "PGRST500" } };
    const sub = await getUserSubscriptionStatus("u1");
    expect(sub.billing).toBe("unavailable");
    expect(sub.status).toBe("none");
    expect(sub.isPremium).toBe(false);
  });

  it("reports `available` and the real status on a clean read", async () => {
    h.subRead = { data: { status: "active" }, error: null };
    const sub = await getUserSubscriptionStatus("u1");
    expect(sub.billing).toBe("available");
    expect(sub.status).toBe("active");
    expect(sub.isPremium).toBe(true);
  });

  it("reports `available` with status none for a genuine no-row account", async () => {
    h.subRead = { data: null, error: null };
    const sub = await getUserSubscriptionStatus("u1");
    expect(sub.billing).toBe("available");
    expect(sub.status).toBe("none");
  });
});

describe("premium/weekly gates fail closed on unavailable billing", () => {
  it("canGenerateWeeklyPlan denies on unavailable even if the count read is fine", async () => {
    h.subRead = { data: null, error: { code: "PGRST500" } };
    h.count = 0;
    expect(await canGenerateWeeklyPlan("u1")).toBe(false);
  });

  it("canUsePremiumFeature denies on unavailable", async () => {
    h.subRead = { data: null, error: { code: "PGRST500" } };
    expect(await canUsePremiumFeature("u1", "journal_reflection")).toBe(false);
  });
});
