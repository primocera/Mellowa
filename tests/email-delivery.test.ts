import { describe, it, expect, vi } from "vitest";
import {
  deliverEmail,
  htmlToText,
  MAX_ATTEMPTS,
  type DeliverDeps,
} from "@/lib/email/deliver";
import type { SendResult } from "@/lib/email/send";

const email = {
  eventKey: "trial_ending:sub_1:2026-07-20",
  userId: "user-1",
  template: "trial_ending",
  to: "user@example.com",
  subject: "Trial ending",
  html: "<p>Hello</p>",
};

/** In-memory ledger implementing the DeliverDeps port. */
function makeDeps(send: (n: number) => SendResult) {
  const rows = new Map<
    string,
    { id: string; status: string; attempts: number; lastError?: string | null }
  >();
  let calls = 0;
  const deps: DeliverDeps = {
    async claim({ eventKey }) {
      if (!rows.has(eventKey)) {
        rows.set(eventKey, { id: eventKey, status: "pending", attempts: 0 });
      }
      return rows.get(eventKey)!;
    },
    async finalize({ id, status, attempts, lastError }) {
      const row = rows.get(id)!;
      row.status = status;
      row.attempts = attempts;
      row.lastError = lastError ?? null;
    },
    send: vi.fn(async () => send(++calls)),
  };
  return { deps, rows, sendMock: deps.send as ReturnType<typeof vi.fn> };
}

describe("deliverEmail (Prompt 2, durable + idempotent)", () => {
  it("marks sent only after provider acceptance", async () => {
    const { deps, rows } = makeDeps(() => ({ sent: true, providerId: "re_1" }));
    const res = await deliverEmail(email, deps);
    expect(res).toEqual({ sent: true, status: "sent" });
    expect(rows.get(email.eventKey)!.status).toBe("sent");
  });

  it("duplicate delivery sends exactly one email", async () => {
    const { deps, sendMock } = makeDeps(() => ({ sent: true }));
    await deliverEmail(email, deps);
    const second = await deliverEmail(email, deps);
    expect(second.status).toBe("duplicate");
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("missing provider config is not_configured, never delivered", async () => {
    const { deps, rows, sendMock } = makeDeps(() => ({
      sent: false,
      skipped: true,
    }));
    const res = await deliverEmail(email, deps);
    expect(res).toEqual({ sent: false, status: "not_configured" });
    expect(rows.get(email.eventKey)!.status).toBe("not_configured");
    // Retryable once configured — a later call attempts again.
    await deliverEmail(email, deps);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("retries transient failures, then succeeds", async () => {
    const { deps, rows } = makeDeps((n) =>
      n < 3 ? { sent: false, error: "network error" } : { sent: true }
    );
    expect((await deliverEmail(email, deps)).status).toBe("failed_transient");
    expect((await deliverEmail(email, deps)).status).toBe("failed_transient");
    expect((await deliverEmail(email, deps)).status).toBe("sent");
    expect(rows.get(email.eventKey)!.status).toBe("sent");
  });

  it("bounded attempts: transient failures become permanent and stop", async () => {
    const { deps, rows, sendMock } = makeDeps(() => ({
      sent: false,
      error: "provider 500",
    }));
    let last = "";
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      last = (await deliverEmail(email, deps)).status;
    }
    expect(last).toBe("failed_permanent");
    expect(rows.get(email.eventKey)!.status).toBe("failed_permanent");
    // Permanent failures stay visible and are never retried.
    await deliverEmail(email, deps);
    expect(sendMock).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it("permanent provider rejection (4xx) fails permanently on first attempt", async () => {
    const { deps } = makeDeps(() => ({
      sent: false,
      permanent: true,
      error: "provider 422",
    }));
    expect((await deliverEmail(email, deps)).status).toBe("failed_permanent");
  });
});

describe("htmlToText", () => {
  it("produces a readable plain-text alternative", () => {
    const text = htmlToText(
      '<p>Hi,</p><p>Check in <a href="https://x.app/today">here</a>.</p>'
    );
    expect(text).toContain("Hi,");
    expect(text).toContain("here (https://x.app/today)");
    expect(text).not.toContain("<");
  });
});
