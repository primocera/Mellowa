import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MW-04: trialDisclosureForViewer must not promise a trial when the billing
 * read failed. A failed read returns an explicit `unavailable` state with
 * trialEligible=false — never a silent "eligible" derived from a swallowed error.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  read: { data: null as Row | null, error: null as Row | null },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => h.read }) }),
    }),
  }),
}));

import { trialDisclosureForViewer } from "@/lib/stripe/trial-disclosure";

beforeEach(() => {
  h.user = { id: "u1" };
  h.read = { data: null, error: null };
});

describe("trialDisclosureForViewer", () => {
  it("marks the disclosure unavailable and promises no trial when the read errors", async () => {
    h.read = { data: null, error: { code: "PGRST500" } };
    const d = await trialDisclosureForViewer();
    expect(d.unavailable).toBe(true);
    expect(d.trialEligible).toBe(false);
    expect(d.days).toBeNull();
    expect(d.chargeDate).toBeNull();
  });

  it("is eligible for a signed-in user with no prior trial (verified_none)", async () => {
    h.read = { data: null, error: null };
    const d = await trialDisclosureForViewer();
    expect(d.unavailable).toBe(false);
    expect(d.trialEligible).toBe(true);
  });

  it("is not eligible once a trial has been used (verified_subscription)", async () => {
    h.read = { data: { trial_used_at: "2026-05-01T00:00:00Z" }, error: null };
    const d = await trialDisclosureForViewer();
    expect(d.unavailable).toBe(false);
    expect(d.trialEligible).toBe(false);
  });
});
