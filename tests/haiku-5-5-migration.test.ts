import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

/**
 * Haiku 5.5 migration: the request shape generateStructuredJson sends, how it
 * reads the answer, and which failures it retries. The provider client is
 * fully mocked — no live AI calls.
 */

const create = vi.fn();
let model = "claude-haiku-5-5";

vi.mock("@/lib/ai/client", () => ({
  getAiClient: () => ({ messages: { create } }),
  getAiModel: () => model,
}));
vi.mock("@/lib/ai/mock", () => ({
  isAiMockEnabled: () => false,
  mockFromSchema: () => ({ ok: true }),
}));
vi.mock("@/lib/ai/model-policy", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/model-policy")>()),
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

import { generateStructuredJson, type UsageSink } from "@/lib/ai/generate-json";
import { MODEL_POLICIES } from "@/lib/ai/model-policy";
import { computeActualCostUsd } from "@/lib/ai/cost";

const schema = z.object({ ok: z.boolean() });

function message(over: Record<string, unknown> = {}) {
  return {
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 20 },
    content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
    ...over,
  };
}

const call = (opts: { maxTokens?: number; deadline?: number; usageSink?: UsageSink } = {}) =>
  generateStructuredJson({ systemPrompt: "s", userPrompt: "u", zodSchema: schema, ...opts });

const body = (i = 0) => create.mock.calls[i][0];
const options = (i = 0) => create.mock.calls[i][1];

beforeEach(() => {
  create.mockReset();
  model = "claude-haiku-5-5";
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("request shape", () => {
  it("sends no sampling params, no thinking budget and no assistant prefill", async () => {
    create.mockResolvedValueOnce(message());
    await call();
    const b = body();
    expect(b).not.toHaveProperty("temperature");
    expect(b).not.toHaveProperty("top_p");
    expect(b).not.toHaveProperty("top_k");
    expect(b).not.toHaveProperty("thinking");
    expect(b.messages.at(-1).role).toBe("user");
  });

  it("no model policy carries sampling params", () => {
    for (const p of Object.values(MODEL_POLICIES)) {
      expect(p).not.toHaveProperty("temperature");
    }
  });
});

describe("effort", () => {
  it("sends effort low on claude-haiku-5-5 by default", async () => {
    create.mockResolvedValueOnce(message());
    await call();
    expect(body().output_config).toEqual({ effort: "low" });
  });

  it("AI_PROVIDER_EFFORT overrides the level; an unknown value falls back to low", async () => {
    vi.stubEnv("AI_PROVIDER_EFFORT", "medium");
    create.mockResolvedValueOnce(message());
    await call();
    expect(body().output_config).toEqual({ effort: "medium" });

    vi.stubEnv("AI_PROVIDER_EFFORT", "turbo");
    create.mockResolvedValueOnce(message());
    await call();
    expect(body(1).output_config).toEqual({ effort: "low" });
  });

  it("sends no effort on a Haiku 4.5 rollback, even with the env var set", async () => {
    model = "claude-haiku-4-5-20251001";
    vi.stubEnv("AI_PROVIDER_EFFORT", "medium");
    create.mockResolvedValueOnce(message());
    await call();
    expect(body()).not.toHaveProperty("output_config");
  });
});

describe("max_tokens headroom", () => {
  it("sends ceil(max_tokens * 1.3) + 4000", async () => {
    create.mockResolvedValueOnce(message());
    await call({ maxTokens: 8192 });
    expect(body().max_tokens).toBe(Math.ceil(8192 * 1.3) + 4000); // 14650
  });

  it("caps below the SDK's non-streaming limit", async () => {
    create.mockResolvedValueOnce(message());
    await call({ maxTokens: 30_000 });
    expect(body().max_tokens).toBe(21_000);
    expect(body().max_tokens).toBeLessThan(21_333);
  });

  it("every route policy stays non-streaming after headroom", () => {
    for (const p of Object.values(MODEL_POLICIES)) {
      expect(Math.ceil(p.maxTokens * 1.3) + 4000).toBeLessThan(21_333);
    }
  });
});

describe("reading the answer", () => {
  it("skips a leading thinking block and reads the text block", async () => {
    create.mockResolvedValueOnce(
      message({
        content: [
          { type: "thinking", thinking: "", signature: "sig" },
          { type: "text", text: JSON.stringify({ ok: true }) },
        ],
      })
    );
    await expect(call()).resolves.toEqual({ ok: true });
  });

  it("stop_reason refusal → refusal error, tokens recorded", async () => {
    create.mockResolvedValueOnce(message({ stop_reason: "refusal", content: [] }));
    const usageSink: UsageSink = {};
    await expect(call({ usageSink })).rejects.toMatchObject({ code: "refusal" });
    expect(usageSink.usage).toMatchObject({ status: "refusal", inputTokens: 10, outputTokens: 20 });
  });

  it("stop_reason max_tokens → truncated error even if the cut-off text parses", async () => {
    create.mockResolvedValueOnce(message({ stop_reason: "max_tokens" }));
    const usageSink: UsageSink = {};
    await expect(call({ usageSink })).rejects.toMatchObject({ code: "truncated" });
    expect(usageSink.usage?.status).toBe("truncated");
  });
});

describe("timeouts and retries", () => {
  const timeoutErr = () => new Anthropic.APIConnectionTimeoutError();

  it("turns off the SDK's own retries so the deadline holds", async () => {
    create.mockResolvedValueOnce(message());
    await call();
    expect(options().maxRetries).toBe(0);
  });

  it("retries a timeout once", async () => {
    vi.useFakeTimers();
    create.mockRejectedValueOnce(timeoutErr()).mockResolvedValueOnce(message());
    const p = call();
    await vi.advanceTimersByTimeAsync(1_600);
    await expect(p).resolves.toEqual({ ok: true });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("retries a 5xx once but never a 400", async () => {
    vi.useFakeTimers();
    create
      .mockRejectedValueOnce(Object.assign(new Error("boom"), { status: 500 }))
      .mockResolvedValueOnce(message());
    const p = call();
    await vi.advanceTimersByTimeAsync(1_600);
    await expect(p).resolves.toEqual({ ok: true });
    expect(create).toHaveBeenCalledTimes(2);

    create.mockReset();
    create.mockRejectedValueOnce(Object.assign(new Error("bad"), { status: 400 }));
    await expect(call()).rejects.toMatchObject({ code: "provider_error" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("a timeout that exhausts the retry is reported as timeout", async () => {
    vi.useFakeTimers();
    create.mockRejectedValue(timeoutErr());
    const p = call();
    const settled = expect(p).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(1_600);
    await settled;
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("does not retry a timeout when the deadline leaves too little budget", async () => {
    create.mockRejectedValueOnce(timeoutErr());
    await expect(call({ deadline: Date.now() + 1_000 })).rejects.toMatchObject({ code: "timeout" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("worst case per route fits Vercel's 300s default maxDuration", () => {
    // Safety check + generation + one corrective generation, each allowed one
    // retry (2 x timeout + 1.5s max jitter). The daily-plan route is tighter
    // still: its generations share one 100s deadline.
    const JITTER = 1_500;
    const worst = (ms: number) => 2 * ms + JITTER;
    const safety = worst(MODEL_POLICIES["safety-check"].timeoutMs);
    for (const [route, p] of Object.entries(MODEL_POLICIES)) {
      if (route === "safety-check") continue;
      expect(safety + 2 * worst(p.timeoutMs), route).toBeLessThanOrEqual(300_000);
    }
  });
});

describe("cost", () => {
  it("prices claude-haiku-5-5 at $0.10 / $0.50 per MTok up to 100K input", () => {
    expect(computeActualCostUsd("claude-haiku-5-5", 100_000, 0)).toBeCloseTo(0.01, 10);
    expect(computeActualCostUsd("claude-haiku-5-5", 2_000, 1_000_000)).toBeCloseTo(0.0002 + 0.5, 10);
  });

  it("prices prompts over 100K input at $0.50 / $2.50 per MTok", () => {
    expect(computeActualCostUsd("claude-haiku-5-5", 100_001, 0)).toBeCloseTo(0.0500005, 10);
    expect(computeActualCostUsd("claude-haiku-5-5", 200_000, 1_000_000)).toBeCloseTo(0.1 + 2.5, 10);
  });

  it("leaves Haiku 4.5 pricing unchanged", () => {
    expect(computeActualCostUsd("claude-haiku-4-5-20251001", 1_000_000, 1_000_000)).toBeCloseTo(6, 10);
  });
});
