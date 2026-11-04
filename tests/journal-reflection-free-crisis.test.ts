import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Free-tier journaling must never trigger the PAID AI safety classifier, yet a
 * crisis entry must still be stopped AND recorded as a private safety_events
 * row (that row is what suppresses activity reminders afterwards).
 *
 * This file keeps the REAL checkInputSafety + deterministic pre-classifier and
 * mocks only the provider and the database, so it proves end to end that the
 * free crisis path logs the event with zero provider calls.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  providerCalls: 0,
  safetyEventInserts: [] as Row[],
  journalInserts: [] as Row[],
}));

vi.mock("@/lib/ai/generate-json", () => ({
  generateStructuredJson: async () => {
    h.providerCalls += 1;
    throw new Error("the provider must not be called on the free path");
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      insert: async (row: Row) => {
        if (table === "safety_events") h.safetyEventInserts.push(row);
        return { error: null };
      },
    }),
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "free-1" } } }) },
    from: () => ({
      insert: async (row: Row) => {
        h.journalInserts.push(row);
        return { error: null };
      },
    }),
  }),
}));

vi.mock("@/lib/consent/status", () => ({
  getConsentStatus: async () => ({ complete: true, missing: [] }),
}));
vi.mock("@/lib/stripe/subscription", () => ({
  getUserSubscriptionStatus: async () => ({ isPremium: false }),
}));
vi.mock("@/lib/ai/guard", () => ({
  guardAiRoute: async () => {
    throw new Error("free users never reach the AI guard");
  },
}));

import { POST } from "@/app/api/ai/journal-reflection/route";

const invoke = (answer: string) =>
  POST(
    new Request("http://t/api/ai/journal-reflection", {
      method: "POST",
      body: JSON.stringify({ prompt: "", answer }),
    })
  );

beforeEach(() => {
  h.providerCalls = 0;
  h.safetyEventInserts = [];
  h.journalInserts = [];
});

describe("journal-reflection free tier: deterministic safety only", () => {
  it("ordinary entry: saved, no provider call, no safety event", async () => {
    const res = await invoke("Busy day, but I took a short walk at lunch.");
    const body = await res.json();
    expect(body).toMatchObject({ blocked: false, saved: true, reflection: null, premium_required: true });
    expect(h.providerCalls).toBe(0);
    expect(h.safetyEventInserts).toHaveLength(0);
    expect(h.journalInserts).toHaveLength(1);
  });

  it("crisis entry: blocked with support message, safety event logged, nothing saved, no provider call", async () => {
    const res = await invoke("I want to kill myself");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.blocked).toBe(true);
    expect(typeof body.user_message).toBe("string");
    expect(h.providerCalls).toBe(0);
    expect(h.safetyEventInserts).toHaveLength(1);
    expect(h.safetyEventInserts[0]).toMatchObject({
      user_id: "free-1",
      source: "journal",
      action_taken: "blocked_generation",
    });
    expect(h.journalInserts).toHaveLength(0);
  });
});
