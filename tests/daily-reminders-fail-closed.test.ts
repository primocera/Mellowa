import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Safety-suppression reads fail CLOSED.
 *
 * 1. The daily-reminder cron reads recent safety_events (crisis / eating-
 *    disorder signals) and subscription status per batch. If either read
 *    errors, the cron cannot tell who must not be nudged — so NOTHING is sent
 *    for that batch (and nobody is marked as sent, so the next run retries).
 * 2. The Today page hides macro estimates when the eating-disorder safety
 *    signal cannot be read (source contract, matching the existing
 *    source-based Today tests).
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  profiles: [] as Row[],
  subsError: null as Row | null,
  safetyError: null as Row | null,
  safetyRows: [] as Row[],
  plannerInputs: [] as Row[][],
  delivered: [] as Row[],
  sentDateUpdates: 0,
}));

/** A thenable query builder that resolves to `result` whatever is chained. */
function chain(result: () => Row, onUpdate?: () => void) {
  const api: Row = {};
  for (const m of ["select", "eq", "not", "order", "limit", "gt", "gte", "lte", "in"]) {
    api[m] = () => api;
  }
  api.update = () => {
    onUpdate?.();
    return api;
  };
  api.then = (resolve: (v: Row) => void) => resolve(result());
  return api;
}

const admin = {
  from(table: string) {
    switch (table) {
      case "wellbeing_profiles":
        return chain(
          () => ({ data: h.profiles, error: null }),
          () => {
            h.sentDateUpdates += 1;
          }
        );
      case "subscriptions":
        return chain(() => ({ data: [], error: h.subsError }));
      case "safety_events":
        return chain(() => ({ data: h.safetyRows, error: h.safetyError }));
      default:
        return chain(() => ({ data: [], error: null }));
    }
  },
};

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }));
vi.mock("@/lib/env", () => ({ serverEnv: { cronSecret: "s", appUrl: "https://example.test" } }));
vi.mock("@/lib/cron-auth", () => ({ requireBearerSecret: () => null }));
vi.mock("@/lib/cron-lease", () => ({
  acquireCronLease: async () => ({ acquired: true, release: async () => {} }),
}));
vi.mock("@/lib/email/recipients", () => ({
  getUserEmails: async (_a: unknown, ids: string[]) =>
    new Map(ids.map((id) => [id, `${id}@example.test`])),
}));
vi.mock("@/lib/email/unsubscribe", () => ({ unsubscribeUrl: () => null }));
vi.mock("@/lib/email/templates", () => ({
  onboardingNudgeEmail: () => ({ subject: "s", html: "h" }),
}));
vi.mock("@/lib/email/deliver", () => ({
  deliverEmail: async (payload: Row) => {
    h.delivered.push(payload);
    return { sent: true, status: "sent" };
  },
}));
// The planner is pure and separately tested; here it simply schedules every
// profile it is given that is not safety-suppressed, so we can observe whether
// the route ever reached it.
vi.mock("@/lib/email/reminder-planner", () => ({
  planReminders: (profiles: Row[]) => {
    h.plannerInputs.push(profiles);
    const due = profiles.filter((p) => !p.safety_suppressed);
    return {
      toDeliver: due.map((p) => ({
        userId: p.user_id,
        localDate: "2026-11-04",
        dedupeKey: `reminder:${p.user_id}:2026-11-04`,
        scheduledAt: "2026-11-04T08:00:00Z",
      })),
      invalidTimezones: 0,
      staleConsent: 0,
      billingState: 0,
      safetySuppressed: profiles.length - due.length,
      pausedOrSkipped: 0,
      inQuietHours: 0,
    };
  },
}));

import { GET } from "@/app/api/cron/daily-reminders/route";

const run = () => GET(new Request("http://t/api/cron/daily-reminders"));

beforeEach(() => {
  h.profiles = [{ user_id: "u-a" }, { user_id: "u-b" }];
  h.subsError = null;
  h.safetyError = null;
  h.safetyRows = [];
  h.plannerInputs = [];
  h.delivered = [];
  h.sentDateUpdates = 0;
});

describe("daily-reminders cron fails closed on suppression-fact reads", () => {
  it("baseline: readable facts → reminders delivered", async () => {
    const res = await run();
    expect(res.status).toBe(200);
    expect(h.delivered.filter((d) => d.template === "daily_reminder")).toHaveLength(2);
  });

  it("a recent safety event suppresses that user", async () => {
    h.safetyRows = [{ user_id: "u-a" }];
    await run();
    const to = h.delivered.filter((d) => d.template === "daily_reminder").map((d) => d.userId);
    expect(to).toEqual(["u-b"]);
  });

  it("safety_events read error → nobody in the batch is sent anything or marked sent", async () => {
    h.safetyError = { message: "db down" };
    const res = await run();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(h.delivered.filter((d) => d.template === "daily_reminder")).toHaveLength(0);
    expect(h.plannerInputs).toHaveLength(0);
    expect(h.sentDateUpdates).toBe(0);
    expect(body.skipped.factsUnavailable).toBe(2);
  });

  it("subscriptions read error → batch skipped too (billing state gates sending)", async () => {
    h.subsError = { message: "db down" };
    await run();
    expect(h.delivered.filter((d) => d.template === "daily_reminder")).toHaveLength(0);
    expect(h.plannerInputs).toHaveLength(0);
  });
});

describe("Today page hides macros when the safety signal cannot be read", () => {
  const today = readFileSync("src/app/(app)/today/page.tsx", "utf8");
  it("reads the error from the safety_events count and fails closed on it", () => {
    expect(today).toMatch(/const \{ count: edSignals, error: edSignalsError \}/);
    expect(today).toMatch(/if \(edSignalsError \|\| \(edSignals \?\? 0\) > 0\) showMacros = false;/);
  });
});
