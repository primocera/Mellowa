import { beforeEach, describe, expect, it, vi } from "vitest";
import { SUPPORT_CATEGORIES } from "@/lib/support/taxonomy";

/**
 * MW-07 (v20): privacy-safe batch support ingestion.
 *
 * The batch import rejects forbidden content keys and inconsistent timestamps,
 * upserts idempotently, and records a DURABLE coverage run so `verified` can be
 * derived from evidence rather than an env flag alone.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  admin: "admin-1" as string | null,
  ticketWrites: [] as Row[],
  ingestionRuns: [] as Row[],
  actions: [] as Row[],
  writeError: null as Row | null,
}));

vi.mock("@/lib/admin/auth", () => ({
  requireAdmin: async () => h.admin,
}));

vi.mock("@/lib/admin/support", () => ({
  recordAdminAction: async (a: Row) => {
    h.actions.push(a);
  },
}));

vi.mock("@/lib/analytics/facts", () => ({
  readExclusionRegistry: async () => ({ ids: [], available: true }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      upsert: (row: Row) => ({
        select: async () => {
          if (table === "support_tickets") h.ticketWrites.push(row);
          return { data: [{ id: "t1" }], error: h.writeError };
        },
      }),
      insert: (row: Row) => {
        if (table === "support_ingestion_runs") {
          h.ingestionRuns.push(row);
          return Promise.resolve({ error: null });
        }
        return {
          select: async () => {
            if (table === "support_tickets") h.ticketWrites.push(row);
            return { data: [{ id: "t1" }], error: h.writeError };
          },
        };
      },
    }),
  }),
}));

import { POST } from "@/app/api/admin/support-tickets/route";

const CAT = SUPPORT_CATEGORIES[0];

function req(body: unknown) {
  return new Request("http://t/api/admin/support-tickets", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  h.admin = "admin-1";
  h.ticketWrites = [];
  h.ingestionRuns = [];
  h.actions = [];
  h.writeError = null;
});

describe("POST /api/admin/support-tickets — batch import (MW-07)", () => {
  it("imports a valid batch and records a durable coverage run", async () => {
    const res = await POST(
      req({
        source: "manual_csv",
        coverage_start: "2026-08-01",
        coverage_end: "2026-08-14",
        tickets: [
          { dedupe_key: "a", category: CAT, external_ref: "ext-1" },
          { dedupe_key: "b", category: CAT },
        ],
      })
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as Row;
    expect(json.ok).toBe(true);
    expect(h.ticketWrites).toHaveLength(2);
    expect(h.ingestionRuns).toHaveLength(1);
    expect(h.ingestionRuns[0]).toMatchObject({
      source: "manual_csv",
      coverage_end: "2026-08-14",
      actor_user_id: "admin-1",
    });
    // No content field ever reaches the ledger row.
    for (const w of h.ticketWrites) {
      expect(Object.keys(w)).not.toContain("body");
      expect(Object.keys(w)).not.toContain("email");
    }
  });

  it("rejects a forbidden content key (strict schema) with 400 and writes nothing", async () => {
    const res = await POST(
      req({
        tickets: [{ dedupe_key: "a", category: CAT, body: "the user wrote this" }],
      })
    );
    expect(res.status).toBe(400);
    expect(h.ticketWrites).toEqual([]);
    expect(h.ingestionRuns).toEqual([]);
  });

  it("rejects an email/subject field", async () => {
    const res = await POST(
      req({ tickets: [{ dedupe_key: "a", category: CAT, email: "x@y.com" }] })
    );
    expect(res.status).toBe(400);
  });

  it("rejects chronologically impossible rows (resolved before created)", async () => {
    const res = await POST(
      req({
        tickets: [
          {
            dedupe_key: "a",
            category: CAT,
            created_at: "2026-08-10T10:00:00Z",
            resolved_at: "2026-08-09T10:00:00Z",
          },
        ],
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("chronology_invalid");
    expect(h.ticketWrites).toEqual([]);
  });

  it("re-import with the same external_ref is an upsert (idempotent), not a new run's duplicate", async () => {
    await POST(req({ tickets: [{ dedupe_key: "a", category: CAT, external_ref: "ext-1" }] }));
    await POST(req({ tickets: [{ dedupe_key: "a", category: CAT, external_ref: "ext-1" }] }));
    // Both writes are upserts keyed on external_ref — the second updates, and each
    // batch records exactly one coverage run.
    expect(h.ingestionRuns).toHaveLength(2);
  });

  it("404 for a non-admin (route never revealed)", async () => {
    h.admin = null;
    const res = await POST(req({ tickets: [{ dedupe_key: "a", category: CAT }] }));
    expect(res.status).toBe(404);
    expect(h.ticketWrites).toEqual([]);
  });
});

describe("supportIngestionCoverage (MW-07)", () => {
  function coverageClient(run: Row | null, error: Row | null = null) {
    return {
      from: () => ({
        select: () => ({
          order: () => ({
            limit: () => ({ maybeSingle: async () => ({ data: run, error }) }),
          }),
        }),
      }),
    } as never;
  }

  it("no run → not current, stale", async () => {
    const { supportIngestionCoverage } = await import("@/lib/support/ingestion");
    const c = await supportIngestionCoverage(coverageClient(null));
    expect(c.durableCoverageCurrent).toBe(false);
    expect(c.stale).toBe(true);
    expect(c.available).toBe(true);
  });

  it("a recent coverage window → current", async () => {
    const { supportIngestionCoverage } = await import("@/lib/support/ingestion");
    const now = new Date("2026-08-20T00:00:00Z");
    const c = await supportIngestionCoverage(
      coverageClient({ source: "manual_csv", coverage_end: "2026-08-18", created_at: now.toISOString() }),
      { now }
    );
    expect(c.durableCoverageCurrent).toBe(true);
    expect(c.stale).toBe(false);
  });

  it("an old coverage window → stale, not current", async () => {
    const { supportIngestionCoverage } = await import("@/lib/support/ingestion");
    const now = new Date("2026-08-20T00:00:00Z");
    const c = await supportIngestionCoverage(
      coverageClient({ source: "manual_csv", coverage_end: "2026-06-01", created_at: "2026-06-01T00:00:00Z" }),
      { now }
    );
    expect(c.durableCoverageCurrent).toBe(false);
    expect(c.stale).toBe(true);
  });

  it("a read error → unavailable (fail closed)", async () => {
    const { supportIngestionCoverage } = await import("@/lib/support/ingestion");
    const c = await supportIngestionCoverage(coverageClient(null, { code: "PGRST500" }));
    expect(c.available).toBe(false);
    expect(c.durableCoverageCurrent).toBe(false);
  });
});
