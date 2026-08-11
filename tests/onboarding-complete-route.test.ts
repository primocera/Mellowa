import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MW-95-03 / MW-V17-06: onboarding_completed is server-authoritative and
 * exactly-once.
 *
 * It is emitted only after the server confirms a durable wellbeing_profiles
 * baseline, and the write is an AWAITED insert backed by a partial unique index
 * (migration 043). A unique violation (23505) is treated as an idempotent
 * "already recorded"; any other write failure returns a typed retryable state
 * instead of a fire-and-forget success.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  profile: { data: { user_id: "u1" } as Row | null, error: null as Row | null },
  completeError: null as { code?: string } | null,
  completions: [] as Row[],
  tracked: [] as Array<{ event: string; opts: unknown }>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => h.profile }) }),
      insert: async (row: Row) => {
        if (table === "onboarding_completions") {
          if (h.completeError) return { error: h.completeError };
          h.completions.push(row);
        }
        return { error: null };
      },
    }),
  }),
}));

vi.mock("@/lib/analytics", () => ({
  trackEvent: (event: string, opts: unknown) => h.tracked.push({ event, opts }),
}));

import { POST } from "@/app/api/onboarding/complete/route";

beforeEach(() => {
  h.user = { id: "u1" };
  h.profile = { data: { user_id: "u1" }, error: null };
  h.completeError = null;
  h.completions = [];
  h.tracked = [];
});

describe("POST /api/onboarding/complete", () => {
  it("401 when unauthenticated, and records nothing", async () => {
    h.user = null;
    const res = await POST();
    expect(res.status).toBe(401);
    expect(h.completions).toEqual([]);
    expect(h.tracked).toEqual([]);
  });

  it("409 and no completion when the baseline was never saved", async () => {
    h.profile = { data: null, error: null };
    const res = await POST();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("profile_not_saved");
    expect(h.completions).toEqual([]);
    expect(h.tracked).toEqual([]);
  });

  it("503 (fail closed) and no completion when the baseline read errors", async () => {
    h.profile = { data: null, error: { code: "PGRST500" } };
    const res = await POST();
    expect(res.status).toBe(503);
    expect(h.completions).toEqual([]);
    expect(h.tracked).toEqual([]);
  });

  it("records the completion once and emits the milestone after a durable baseline", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect((await res.json()).alreadyRecorded).toBe(false);
    expect(h.completions).toEqual([{ user_id: "u1" }]);
    expect(h.tracked).toHaveLength(1);
    expect(h.tracked[0].event).toBe("onboarding_completed");
    expect(h.tracked[0].opts).toEqual({ userId: "u1", properties: { surface: "onboarding" } });
  });

  it("is idempotent: a unique-violation (23505) is alreadyRecorded and emits no second milestone", async () => {
    h.completeError = { code: "23505" };
    const res = await POST();
    expect(res.status).toBe(200);
    expect((await res.json()).alreadyRecorded).toBe(true);
    expect(h.tracked).toEqual([]);
  });

  it("fails closed (503 retryable) on any other write error — does not claim completion", async () => {
    h.completeError = { code: "PGRST999" };
    const res = await POST();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("completion_write_failed");
    expect(h.tracked).toEqual([]);
  });
});

describe("the analytics taxonomy refuses a client-asserted completion", () => {
  it("onboarding_completed is server-authoritative, so the client endpoint would 403 it", async () => {
    const { CLIENT_EVENTS, SERVER_AUTHORITATIVE_EVENTS } = await import(
      "@/lib/analytics/taxonomy"
    );
    expect(SERVER_AUTHORITATIVE_EVENTS.has("onboarding_completed")).toBe(true);
    expect(CLIENT_EVENTS.has("onboarding_completed")).toBe(false);
  });
});
