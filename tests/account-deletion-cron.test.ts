import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MW-V18-04: the deletion worker cron fails closed on auth (mirroring every
 * other cron) and, when authorized, drives due jobs via runDeletionWorker.
 */

const h = vi.hoisted(() => ({ ran: 0, summary: { claimed: 2, completed: 1, retried: 1 } }));

vi.mock("@/lib/account-deletion/worker", () => ({
  runDeletionWorker: async () => {
    h.ran++;
    return h.summary;
  },
}));

process.env.CRON_SECRET = "cron-secret-xyz";

import { POST } from "@/app/api/cron/account-deletion/route";

const req = (auth?: string) =>
  new Request("http://x/api/cron/account-deletion", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });

beforeEach(() => {
  h.ran = 0;
});
afterAll(() => {
  delete process.env.CRON_SECRET;
});

describe("POST /api/cron/account-deletion", () => {
  it("401 without the bearer secret — worker never runs", async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(h.ran).toBe(0);
  });

  it("401 with the wrong secret", async () => {
    const res = await POST(req("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(h.ran).toBe(0);
  });

  it("runs the worker and returns its summary when authorized", async () => {
    const res = await POST(req("Bearer cron-secret-xyz"));
    expect(res.status).toBe(200);
    expect(h.ran).toBe(1);
    expect(await res.json()).toEqual({ ok: true, claimed: 2, completed: 1, retried: 1 });
  });
});
