import { describe, expect, it } from "vitest";
import {
  backoffDelayMinutes,
  replayDeliveries,
  MAX_ATTEMPTS,
  type OutboxRow,
} from "@/lib/email/deliver";

const row = (over: Partial<OutboxRow> = {}): OutboxRow => ({
  id: "r1",
  event_key: "welcome:u1",
  template: "welcome",
  status: "failed_transient",
  attempts: 1,
  to_email: "person@example.com",
  subject: "Hello",
  html: "<p>Hi</p>",
  ...over,
});

describe("backoffDelayMinutes (v6 Prompt 4)", () => {
  it("doubles per attempt and caps at 2 hours", () => {
    const noJitter = () => 0.5; // jitter factor 1.0
    expect(backoffDelayMinutes(1, noJitter)).toBe(5);
    expect(backoffDelayMinutes(2, noJitter)).toBe(10);
    expect(backoffDelayMinutes(3, noJitter)).toBe(20);
    expect(backoffDelayMinutes(10, noJitter)).toBe(120);
  });

  it("applies bounded jitter", () => {
    expect(backoffDelayMinutes(1, () => 0)).toBe(4); // -20%
    expect(backoffDelayMinutes(1, () => 1)).toBe(6); // +20%
  });
});

describe("replayDeliveries", () => {
  it("sends a stored payload and finalizes as sent", async () => {
    const finalized: unknown[] = [];
    const summary = await replayDeliveries(20, {
      claimDue: async () => [row()],
      finalize: async (args) => {
        finalized.push(args);
      },
      send: async () => ({ sent: true, providerId: "p1" }),
    });
    expect(summary).toMatchObject({ claimed: 1, sent: 1, transient: 0 });
    expect(finalized[0]).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("schedules another retry with backoff on transient failure", async () => {
    const finalized: { status: string; nextAttemptAt?: string | null }[] = [];
    const summary = await replayDeliveries(20, {
      claimDue: async () => [row()],
      finalize: async (args) => {
        finalized.push(args);
      },
      send: async () => ({ sent: false, error: "429" }),
    });
    expect(summary.transient).toBe(1);
    expect(finalized[0].status).toBe("failed_transient");
    expect(finalized[0].nextAttemptAt).toBeTruthy();
  });

  it("dead-letters after MAX_ATTEMPTS and clears the retry schedule", async () => {
    const finalized: { status: string; nextAttemptAt?: string | null }[] = [];
    await replayDeliveries(20, {
      claimDue: async () => [row({ attempts: MAX_ATTEMPTS - 1 })],
      finalize: async (args) => {
        finalized.push(args);
      },
      send: async () => ({ sent: false, error: "550" }),
    });
    expect(finalized[0].status).toBe("failed_permanent");
    expect(finalized[0].nextAttemptAt ?? null).toBeNull();
  });

  it("dead-letters legacy rows without a stored payload", async () => {
    const finalized: { status: string }[] = [];
    const summary = await replayDeliveries(20, {
      claimDue: async () => [row({ to_email: null, subject: null, html: null })],
      finalize: async (args) => {
        finalized.push(args);
      },
      send: async () => {
        throw new Error("must not send without payload");
      },
    });
    expect(summary.skippedNoPayload).toBe(1);
    expect(finalized[0].status).toBe("failed_permanent");
  });
});
