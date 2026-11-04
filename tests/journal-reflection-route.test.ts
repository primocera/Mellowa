import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MW-P0-02: route-level behavioral tests for the journal-reflection route.
 *
 * Unit tests for `checkJournalReflectionOutput` alone are insufficient — they
 * cannot prove the real route invokes the guard, performs exactly one
 * corrective retry, and closes the usage reservation on every terminal path.
 * This file exercises the exported `POST` handler with the provider and ledger
 * boundaries mocked deterministically, while keeping the REAL safety guard and
 * REAL `sumUsage` so a removed guard or broken accounting fails a test.
 *
 * The MW-P0-01 defect (imported-but-unused guard + no finalize/release) would
 * make the retry, both-unsafe, provider-error and success-finalize cases fail.
 */

import type { JournalReflectionOutputType } from "@/schemas/ai-output";
import type { UsageSink } from "@/lib/ai/generate-json";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  // Provider: queue of {result, usage} per attempt, or an error to throw.
  attempts: [] as Array<
    | { kind: "ok"; result: JournalReflectionOutputType; usage?: Row }
    | { kind: "throw"; error: unknown; usage?: Row }
  >,
  providerCalls: [] as Array<{ userPrompt: string }>,
  // Ledger spies.
  finalizeCalls: [] as Array<Row>,
  releaseCalls: [] as Array<string | null | undefined>,
  // Auth / consent / entitlement / guard / input-safety knobs.
  user: { id: "user-1" } as { id: string } | null,
  consentComplete: true,
  isPremium: true,
  // null = guard passes with eventId "evt-1"; otherwise the denial to return.
  guardDenial: null as null | { status: number; body: Row },
  guardCalls: [] as Row[],
  safetyCalls: [] as string[],
  order: [] as string[],
  inputBlocked: false,
  saveError: null as Row | null,
  inserted: [] as Row[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from: () => ({
      insert: async (payload: Row) => {
        h.inserted.push(payload);
        return { error: h.saveError };
      },
    }),
  }),
}));

vi.mock("@/lib/safety/check-input", async () => {
  // Mirror the real contract: the deterministic pre-classifier short-circuits
  // first (no provider call); otherwise the (paid) AI classifier verdict.
  const { preClassifySafety } = await import("@/lib/safety/pre-classify");
  return {
    checkInputSafety: async (_userId: string, _source: string, text: string) => {
      h.safetyCalls.push(text);
      h.order.push("checkInputSafety");
      const pre = preClassifySafety(text);
      if (pre) return pre;
      return {
        should_block_generation: h.inputBlocked,
        user_message: h.inputBlocked ? "Let's keep this gentle." : null,
      };
    },
  };
});

vi.mock("@/lib/consent/status", () => ({
  getConsentStatus: async () =>
    h.consentComplete
      ? { complete: true, missing: [] }
      : { complete: false, missing: ["health_data"] },
}));

vi.mock("@/lib/stripe/subscription", () => ({
  getUserSubscriptionStatus: async () => ({ isPremium: h.isPremium }),
}));

vi.mock("@/lib/ai/guard", async () => {
  const { NextResponse } = await import("next/server");
  return {
    guardAiRoute: async (userId: string, opts: Row) => {
      h.guardCalls.push({ userId, ...opts });
      h.order.push("guard");
      if (h.guardDenial) {
        return NextResponse.json(h.guardDenial.body, { status: h.guardDenial.status });
      }
      return { eventId: "evt-1" };
    },
  };
});

// Provider boundary: consume the queued attempt, write into the caller's sink.
vi.mock("@/lib/ai/generate-json", () => ({
  generateStructuredJson: vi.fn(
    async (opts: { userPrompt: string; usageSink?: UsageSink }) => {
      h.providerCalls.push({ userPrompt: opts.userPrompt });
      const next = h.attempts.shift();
      if (!next) throw new Error("no queued provider attempt");
      if (opts.usageSink) {
        opts.usageSink.usage = {
          provider: "anthropic",
          model: "claude-mock",
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 5,
          status: next.kind === "ok" ? "success" : "provider_error",
          ...(next.usage ?? {}),
        } as never;
      }
      if (next.kind === "throw") throw next.error;
      return next.result;
    }
  ),
}));

// Ledger boundary: spy on finalize/release, keep sumUsage real so token
// summing across attempts is genuinely exercised.
vi.mock("@/lib/ai/usage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/usage")>();
  return {
    ...actual,
    finalizeAiUsage: vi.fn(async (eventId: string | null | undefined, input: Row) => {
      h.finalizeCalls.push({ eventId, ...input });
    }),
    releaseReservation: vi.fn(async (eventId: string | null | undefined) => {
      h.releaseCalls.push(eventId);
    }),
  };
});

const safeReflection = (): JournalReflectionOutputType => ({
  reflection: "It sounds like today asked a lot of you, and you still showed up.",
  gentle_question: "What is one thing that felt steady today?",
  one_small_action: "Take three slow breaths before your next task.",
});

// Trips checkJournalReflectionOutput's JOURNAL_BANNED clinical pattern.
const unsafeReflection = (): JournalReflectionOutputType => ({
  reflection: "These are clinical symptoms and you should see a therapist.",
  gentle_question: "Have you considered medication?",
  one_small_action: "Call a crisis line.",
});

async function invoke(body: unknown = { prompt: "How was today?", answer: "Busy but okay." }) {
  const { POST } = await import("@/app/api/ai/journal-reflection/route");
  const req = new Request("http://test/api/ai/journal-reflection", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const res = await POST(req);
  return { status: res.status, json: (await res.json()) as Row };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.attempts = [];
  h.providerCalls = [];
  h.finalizeCalls = [];
  h.releaseCalls = [];
  h.user = { id: "user-1" };
  h.consentComplete = true;
  h.isPremium = true;
  h.guardDenial = null;
  h.guardCalls = [];
  h.safetyCalls = [];
  h.order = [];
  h.inputBlocked = false;
  h.saveError = null;
  h.inserted = [];
});

describe("journal-reflection route — entitlement", () => {
  it("free/non-entitled user: entry saved, no premium reflection, no provider call, no claim finalize", async () => {
    h.isPremium = false;
    const { json } = await invoke();
    expect(json.saved).toBe(true);
    expect(json.reflection).toBeNull();
    expect(json.premium_required).toBe(true);
    expect(h.providerCalls).toHaveLength(0);
    expect(h.finalizeCalls).toHaveLength(0);
    expect(h.releaseCalls).toHaveLength(0);
    expect(h.inserted).toHaveLength(1); // journal still saved
  });

  it("free user: the PAID classifier (checkInputSafety) is never called and no guard/reservation", async () => {
    h.isPremium = false;
    h.inputBlocked = true; // even if the AI classifier WOULD block, it is never asked
    const { json } = await invoke();
    expect(h.safetyCalls).toHaveLength(0);
    expect(h.guardCalls).toHaveLength(0);
    expect(json.saved).toBe(true);
    expect(json.blocked).toBe(false);
  });

  it("free user with crisis text: deterministic block, crisis message, nothing saved, no provider", async () => {
    h.isPremium = false;
    const { status, json } = await invoke({ prompt: "", answer: "I want to kill myself" });
    expect(status).toBe(200);
    expect(json.blocked).toBe(true);
    expect(typeof json.user_message).toBe("string");
    expect(h.inserted).toHaveLength(0);
    expect(h.providerCalls).toHaveLength(0);
    expect(h.guardCalls).toHaveLength(0);
  });

  it("unauthenticated request is rejected before any work", async () => {
    h.user = null;
    const { status } = await invoke();
    expect(status).toBe(401);
    expect(h.inserted).toHaveLength(0);
    expect(h.providerCalls).toHaveLength(0);
  });
});

describe("journal-reflection route — consent", () => {
  it("no current consent → 403 consent_required; nothing stored, classified or reserved", async () => {
    h.consentComplete = false;
    const { status, json } = await invoke();
    expect(status).toBe(403);
    expect(json.error).toBe("consent_required");
    expect(h.inserted).toHaveLength(0);
    expect(h.safetyCalls).toHaveLength(0);
    expect(h.guardCalls).toHaveLength(0);
    expect(h.providerCalls).toHaveLength(0);
  });

  it("no consent blocks free users too (no deterministic classification or save)", async () => {
    h.consentComplete = false;
    h.isPremium = false;
    const { status } = await invoke({ prompt: "", answer: "I want to kill myself" });
    expect(status).toBe(403);
    expect(h.inserted).toHaveLength(0);
    expect(h.safetyCalls).toHaveLength(0);
  });
});

describe("journal-reflection route — premium guard", () => {
  it("premium: guardAiRoute runs BEFORE checkInputSafety, for the journal-reflection route", async () => {
    h.attempts = [{ kind: "ok", result: safeReflection() }];
    await invoke();
    expect(h.guardCalls).toHaveLength(1);
    expect(h.guardCalls[0]).toMatchObject({ userId: "user-1", route: "journal-reflection" });
    expect(h.order.indexOf("guard")).toBeGreaterThanOrEqual(0);
    expect(h.order.indexOf("guard")).toBeLessThan(h.order.indexOf("checkInputSafety"));
  });

  it("guard rate limit (429): entry saved gracefully, rate_limited flag, no paid classifier, no provider", async () => {
    h.guardDenial = { status: 429, body: { error: "rate_limited", scope: "day" } };
    const { status, json } = await invoke();
    expect(status).toBe(200);
    expect(json).toMatchObject({ saved: true, reflection: null, rate_limited: true, capacity: false });
    expect(h.inserted).toHaveLength(1);
    expect(h.safetyCalls).toHaveLength(0);
    expect(h.providerCalls).toHaveLength(0);
  });

  it("guard capacity (503): entry saved, capacity flag", async () => {
    h.guardDenial = { status: 503, body: { error: "capacity" } };
    const { json } = await invoke();
    expect(json).toMatchObject({ saved: true, reflection: null, capacity: true, rate_limited: false });
  });

  it("operator kill switch (403 generation_unavailable): entry saved, no reflection, no provider", async () => {
    h.guardDenial = { status: 403, body: { error: "generation_unavailable" } };
    const { json } = await invoke();
    expect(json).toMatchObject({ saved: true, reflection: null, generation_unavailable: true });
    expect(h.providerCalls).toHaveLength(0);
  });

  it("guard denial still screens crisis text deterministically and stores nothing", async () => {
    h.guardDenial = { status: 429, body: { error: "rate_limited" } };
    const { json } = await invoke({ prompt: "", answer: "I want to kill myself" });
    expect(json.blocked).toBe(true);
    expect(h.inserted).toHaveLength(0);
  });

  it("guard consent_required (race) is returned as-is with nothing stored", async () => {
    h.guardDenial = { status: 403, body: { error: "consent_required", missing: ["terms"] } };
    const { status, json } = await invoke();
    expect(status).toBe(403);
    expect(json.error).toBe("consent_required");
    expect(h.inserted).toHaveLength(0);
  });
});

describe("journal-reflection route — input safety", () => {
  it("input-safety block: no provider call, reservation finalized as safety_blocked, nothing saved", async () => {
    h.inputBlocked = true;
    const { json } = await invoke();
    expect(json.blocked).toBe(true);
    expect(typeof json.user_message).toBe("string");
    expect(h.providerCalls).toHaveLength(0);
    expect(h.inserted).toHaveLength(0);
    // The guard reserved a row; it is closed exactly once with the safety outcome.
    expect(h.finalizeCalls).toHaveLength(1);
    expect(h.finalizeCalls[0]).toMatchObject({ eventId: "evt-1", status: "safety_blocked" });
    expect(h.releaseCalls).toHaveLength(0);
  });
});

describe("journal-reflection route — premium success", () => {
  it("one provider call, safe output returned, exactly one success finalize with prompt version", async () => {
    h.attempts = [{ kind: "ok", result: safeReflection() }];
    const { json } = await invoke();
    expect(json.reflection).toMatchObject({ reflection: expect.any(String) });
    expect(h.providerCalls).toHaveLength(1);
    expect(h.finalizeCalls).toHaveLength(1);
    expect(h.finalizeCalls[0]).toMatchObject({
      eventId: "evt-1",
      status: "success",
      retryCount: 0,
    });
    expect(h.finalizeCalls[0].promptVersion).toBeTruthy();
    expect(h.releaseCalls).toHaveLength(0);
  });
});

describe("journal-reflection route — corrective retry", () => {
  it("first output unsafe, retry safe: exactly two calls, retry_count=1, combined tokens, one terminal success", async () => {
    h.attempts = [
      { kind: "ok", result: unsafeReflection(), usage: { inputTokens: 100, outputTokens: 40 } },
      { kind: "ok", result: safeReflection(), usage: { inputTokens: 120, outputTokens: 60 } },
    ];
    const { json } = await invoke();
    // Only the safe retry is returned.
    expect(json.reflection).toMatchObject({ reflection: safeReflection().reflection });
    expect(h.providerCalls).toHaveLength(2);
    expect(h.finalizeCalls).toHaveLength(1);
    const f = h.finalizeCalls[0];
    expect(f.status).toBe("success");
    expect(f.retryCount).toBe(1);
    // sumUsage (real) added both attempts' tokens.
    expect((f.usage as Row).inputTokens).toBe(220);
    expect((f.usage as Row).outputTokens).toBe(100);
  });

  it("both outputs unsafe: exactly two calls, fail closed, no reflection returned, safety_blocked finalize", async () => {
    h.attempts = [
      { kind: "ok", result: unsafeReflection(), usage: { inputTokens: 100, outputTokens: 40 } },
      { kind: "ok", result: unsafeReflection(), usage: { inputTokens: 110, outputTokens: 50 } },
    ];
    const { json } = await invoke();
    expect(h.providerCalls).toHaveLength(2); // exactly one retry, never more
    expect(json.reflection).toBeNull();
    expect(json.reflection_unavailable).toBe(true);
    expect(json.saved).toBe(true);
    expect(h.finalizeCalls).toHaveLength(1);
    expect(h.finalizeCalls[0].status).toBe("safety_blocked");
    expect(h.finalizeCalls[0].retryCount).toBe(1);
    // The unsafe draft never leaves the server.
    expect(JSON.stringify(json)).not.toContain("symptoms");
    expect(JSON.stringify(json)).not.toContain("therapist");
  });
});

describe("journal-reflection route — provider failure", () => {
  it("provider error after a real attempt: finalize with provider status, no release", async () => {
    h.attempts = [
      { kind: "throw", error: new Error("boom"), usage: { inputTokens: 30, outputTokens: 0 } },
    ];
    const { json } = await invoke();
    expect(json.reflection).toBeNull();
    expect(json.saved).toBe(true);
    expect(h.finalizeCalls).toHaveLength(1);
    expect(h.finalizeCalls[0].status).toBe("provider_error");
    expect(h.releaseCalls).toHaveLength(0);
  });
});

describe("journal-reflection route — reservation without provider work", () => {
  it("premium save failure returns 500 and RELEASES the reservation (no finalize, no provider)", async () => {
    h.saveError = { message: "db down" };
    const { status, json } = await invoke();
    expect(status).toBe(500);
    expect(json.error).toBe("Failed to save entry");
    expect(h.finalizeCalls).toHaveLength(0);
    expect(h.releaseCalls).toEqual(["evt-1"]);
    expect(h.providerCalls).toHaveLength(0);
  });

  it("free save failure returns 500 with no reservation at all", async () => {
    h.isPremium = false;
    h.saveError = { message: "db down" };
    const { status } = await invoke();
    expect(status).toBe(500);
    expect(h.finalizeCalls).toHaveLength(0);
    expect(h.releaseCalls).toHaveLength(0);
  });
});

describe("journal-reflection route — ledger payload privacy", () => {
  it("no journal text, prompt, reflection, or banned phrase reaches the ledger payloads", async () => {
    h.attempts = [
      { kind: "ok", result: unsafeReflection() },
      { kind: "ok", result: safeReflection() },
    ];
    await invoke({ prompt: "SECRET-PROMPT", answer: "SECRET-JOURNAL-TEXT" });
    const ledgerBlob = JSON.stringify(h.finalizeCalls);
    expect(ledgerBlob).not.toContain("SECRET-PROMPT");
    expect(ledgerBlob).not.toContain("SECRET-JOURNAL-TEXT");
    expect(ledgerBlob).not.toContain("gentle_question");
    expect(ledgerBlob).not.toContain("symptoms");
  });
});
