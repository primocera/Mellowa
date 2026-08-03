import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MW-04: a failed quota/count read must NOT become zero usage and grant a free
 * generation. canGenerateDailyPlan must fail closed (deny) when the count query
 * errors, and only allow when a real count is below the sample limit.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  // subscriptions read → drives getUserPlan (null data = "none" = sample plan)
  subRead: { data: null as Row | null, error: null as Row | null },
  // daily_plans count query result
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
          // count query (head:true) resolves to { count, error }
          return Promise.resolve({ count: h.count, error: h.countError });
        },
      }),
    }),
  }),
}));

import { canGenerateDailyPlan } from "@/lib/stripe/subscription";

beforeEach(() => {
  h.subRead = { data: null, error: null }; // sample plan
  h.count = 0;
  h.countError = null;
});

describe("canGenerateDailyPlan fails closed on an unverifiable quota", () => {
  it("DENIES when the count read errors (never treats the error as 0 usage)", async () => {
    h.count = null;
    h.countError = { code: "PGRST500" };
    expect(await canGenerateDailyPlan("u1")).toBe(false);
  });

  it("allows the one lifetime sample when the real count is 0", async () => {
    h.count = 0;
    expect(await canGenerateDailyPlan("u1")).toBe(true);
  });

  it("denies a second sample once one has been generated", async () => {
    h.count = 1;
    expect(await canGenerateDailyPlan("u1")).toBe(false);
  });
});
