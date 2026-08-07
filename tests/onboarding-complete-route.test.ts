import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MW-95-03: onboarding_completed is server-authoritative.
 *
 * These prove the two properties that make the milestone trustworthy: it is
 * emitted only after the server confirms a durable wellbeing_profiles baseline,
 * and a retry never writes a second milestone. A companion assertion proves the
 * client event endpoint refuses the event outright.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  profile: { data: { user_id: "u1" } as Row | null, error: null as Row | null },
  existingEvent: { data: null as Row | null, error: null as Row | null },
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
      select: () => ({
        eq: () => ({
          // profiles read
          maybeSingle: async () => (table === "wellbeing_profiles" ? h.profile : h.existingEvent),
          eq: () => ({
            limit: () => ({ maybeSingle: async () => h.existingEvent }),
          }),
        }),
      }),
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
  h.existingEvent = { data: null, error: null };
  h.tracked = [];
});

describe("POST /api/onboarding/complete", () => {
  it("401 when unauthenticated, and emits nothing", async () => {
    h.user = null;
    const res = await POST();
    expect(res.status).toBe(401);
    expect(h.tracked).toEqual([]);
  });

  it("409 and no emit when the baseline was never saved", async () => {
    h.profile = { data: null, error: null };
    const res = await POST();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("profile_not_saved");
    expect(h.tracked).toEqual([]);
  });

  it("503 (fail closed) and no emit when the baseline read errors", async () => {
    h.profile = { data: null, error: { code: "PGRST500" } };
    const res = await POST();
    expect(res.status).toBe(503);
    expect(h.tracked).toEqual([]);
  });

  it("emits onboarding_completed once, surface-only, after a durable baseline", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(h.tracked).toHaveLength(1);
    expect(h.tracked[0].event).toBe("onboarding_completed");
    expect(h.tracked[0].opts).toEqual({
      userId: "u1",
      properties: { surface: "onboarding" },
    });
  });

  it("is idempotent: a retry with the milestone already present emits nothing", async () => {
    h.existingEvent = { data: { id: "evt_1" }, error: null };
    const res = await POST();
    expect(res.status).toBe(200);
    expect((await res.json()).alreadyRecorded).toBe(true);
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
