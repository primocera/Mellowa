import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * WS-B (v21): the daily-plan (user, day) claim lease must never expire while the
 * original request is still legitimately awaiting the provider. generateJson now
 * accepts a shared wall-clock `deadline` that bounds the TOTAL provider time —
 * across the single rate-limit/overload retry and its jitter — so an atomic
 * claim held for the whole request cannot be reclaimed by a follower mid-flight
 * (which would incur a second billable generation).
 *
 * The provider client is fully mocked; these tests assert the deadline math, not
 * the network.
 */

const create = vi.fn();

vi.mock("@/lib/ai/client", () => ({
  getAiClient: () => ({ messages: { create } }),
  getAiModel: () => "test-model",
}));
vi.mock("@/lib/ai/mock", () => ({
  isAiMockEnabled: () => false,
  mockFromSchema: () => ({ ok: true }),
}));
vi.mock("@/lib/ai/model-policy", () => ({
  isKilled: () => false,
  policyFor: () => null,
}));
vi.mock("@/lib/ai/circuit-breaker", () => ({
  CircuitBreaker: class {
    isOpen() {
      return false;
    }
    recordFailure() {}
    recordSuccess() {}
  },
}));

import { generateStructuredJson } from "@/lib/ai/generate-json";
import {
  DAILY_PLAN_LEASE_SECONDS,
  DAILY_PLAN_PROVIDER_BUDGET_MS,
} from "@/lib/ai/daily-plan-claim";

const schema = z.object({ ok: z.boolean() });

function okMessage() {
  return {
    usage: { input_tokens: 10, output_tokens: 20 },
    content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
  };
}
const rateLimit = () => Object.assign(new Error("rate limited"), { status: 429 });

const call = (deadline?: number) =>
  generateStructuredJson({
    systemPrompt: "s",
    userPrompt: "u",
    zodSchema: schema,
    deadline,
  });

beforeEach(() => {
  create.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("generateStructuredJson shared deadline (WS-B)", () => {
  it("throws timeout WITHOUT calling the provider when the deadline is already spent", async () => {
    await expect(call(Date.now() - 1)).rejects.toMatchObject({ code: "timeout" });
    expect(create).not.toHaveBeenCalled();
  });

  it("caps the per-attempt timeout to the remaining budget", async () => {
    create.mockResolvedValueOnce(okMessage());
    await call(Date.now() + 1_000);
    expect(create).toHaveBeenCalledTimes(1);
    // Second arg is { timeout } — capped to the ~1s remaining, never the 60s base.
    expect(create.mock.calls[0][1].timeout).toBeLessThanOrEqual(1_000);
    expect(create.mock.calls[0][1].timeout).toBeGreaterThan(0);
  });

  it("does NOT retry a rate-limit error when too little budget remains", async () => {
    create.mockRejectedValueOnce(rateLimit());
    await expect(call(Date.now() + 1_000)).rejects.toBeTruthy();
    // Under the 2s minimum retry budget → fail closed, exactly one attempt.
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("still performs the single retry when ample budget remains", async () => {
    vi.useFakeTimers();
    create.mockRejectedValueOnce(rateLimit()).mockResolvedValueOnce(okMessage());
    const p = call(Date.now() + 60_000);
    // Let the jitter sleep (<=1.5s) elapse.
    await vi.advanceTimersByTimeAsync(1_600);
    await expect(p).resolves.toEqual({ ok: true });
    expect(create).toHaveBeenCalledTimes(2);
    // Both attempts stayed within the base per-attempt cap.
    for (const c of create.mock.calls) {
      expect(c[1].timeout).toBeLessThanOrEqual(60_000);
    }
  });

  it("without a deadline, behaviour is unchanged (one attempt, full base timeout)", async () => {
    create.mockResolvedValueOnce(okMessage());
    await call();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][1].timeout).toBe(60_000);
  });
});

describe("daily-plan provider budget is held below the lease (WS-B)", () => {
  it("the total provider budget leaves comfortable headroom under the lease", () => {
    const leaseMs = DAILY_PLAN_LEASE_SECONDS * 1_000;
    expect(DAILY_PLAN_PROVIDER_BUDGET_MS).toBeLessThan(leaseMs);
    // At least 15s of headroom for the surrounding DB writes inside the lease.
    expect(leaseMs - DAILY_PLAN_PROVIDER_BUDGET_MS).toBeGreaterThanOrEqual(15_000);
  });
});
