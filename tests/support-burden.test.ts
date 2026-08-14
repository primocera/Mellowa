import { describe, expect, it } from "vitest";
import { supportBurden, type SupportTicketRow } from "@/lib/support/metrics";
import { SupportTicketInput, SUPPORT_CATEGORIES } from "@/lib/support/taxonomy";
import { buildCohortScorecard, type CohortEventRow } from "@/lib/analytics/cohort";

/**
 * MW-V18-08: support burden is measured from a privacy-safe ledger — deduped by
 * issue, staff excluded, per-100 denominators suppressed under MIN_COHORT,
 * medians and unresolved safety/billing surfaced — and a read error is
 * UNAVAILABLE, never a fabricated zero. The input schema stores no content.
 */

const ticket = (over: Partial<SupportTicketRow>): SupportTicketRow => ({
  dedupe_key: "k",
  account_user_id: "u",
  category: "bug",
  status: "open",
  reopened_count: 0,
  first_response_at: null,
  resolved_at: null,
  created_at: "2026-08-01T00:00:00Z",
  ...over,
});

describe("redaction by schema", () => {
  it("rejects any message-content field (strict schema)", () => {
    const bad = SupportTicketInput.safeParse({
      dedupe_key: "k",
      category: "bug",
      body: "I feel terrible and skipped meals", // must never be accepted
    });
    expect(bad.success).toBe(false);
  });

  it("accepts a clean, content-free ticket", () => {
    const ok = SupportTicketInput.safeParse({ dedupe_key: "k", category: "billing" });
    expect(ok.success).toBe(true);
  });

  it("category vocabulary is fixed and server-owned", () => {
    expect(SUPPORT_CATEGORIES).toContain("safety_concern");
    expect(SUPPORT_CATEGORIES).toContain("account_deletion");
  });
});

describe("dedupe and exclusion", () => {
  it("counts distinct issues, not repeated contacts, and excludes staff", () => {
    const tickets = [
      ticket({ dedupe_key: "i1", account_user_id: "a" }),
      ticket({ dedupe_key: "i1", account_user_id: "a", created_at: "2026-08-02T00:00:00Z" }), // same issue
      ticket({ dedupe_key: "i2", account_user_id: "b" }),
      ticket({ dedupe_key: "i3", account_user_id: "staff" }), // excluded
    ];
    const b = supportBurden({
      tickets,
      activatedUsers: 10,
      paidUsers: 10,
      excludedUserIds: ["staff"],
    });
    expect(b.contacts).toBe(2); // i1 (deduped) + i2; staff removed
  });
});

describe("denominators and rates", () => {
  it("per-100 is suppressed below MIN_COHORT and computed above it", () => {
    const tickets = [ticket({ dedupe_key: "i1" }), ticket({ dedupe_key: "i2" })];
    const small = supportBurden({ tickets, activatedUsers: 3, paidUsers: 3 });
    expect(small.contactsPer100Activated).toBeNull();

    const big = supportBurden({ tickets, activatedUsers: 200, paidUsers: 50 });
    expect(big.contactsPer100Activated).toBe(1); // 2/200*100 = 1.0
    expect(big.contactsPer100Paid).toBe(4); // 2/50*100 = 4.0
  });
});

describe("timings, reopen and unresolved critical", () => {
  const tickets = [
    // resolved billing, 60 min TTFR, 120 min resolution
    ticket({
      dedupe_key: "b1",
      category: "billing",
      status: "resolved",
      first_response_at: "2026-08-01T01:00:00Z",
      resolved_at: "2026-08-01T02:00:00Z",
    }),
    // reopened
    ticket({ dedupe_key: "b2", category: "bug", status: "resolved", reopened_count: 1 }),
    // unresolved safety — a launch signal
    ticket({ dedupe_key: "s1", category: "safety_concern", status: "open" }),
    ...Array.from({ length: 3 }, (_, i) =>
      ticket({ dedupe_key: `c${i}`, category: "other", status: "closed" })
    ),
  ];
  const b = supportBurden({ tickets, activatedUsers: 100, paidUsers: 20 });

  it("medians over tickets that have the timestamp", () => {
    expect(b.medianFirstResponseMin).toBe(60);
    expect(b.medianResolutionMin).toBe(120);
  });
  it("counts unresolved safety/billing/deletion", () => {
    expect(b.unresolvedCritical).toBe(1); // the open safety_concern
  });
  it("reopen rate over resolved/closed issues (>= MIN_COHORT)", () => {
    // resolved-or-closed = b1, b2, c0, c1, c2 = 5; reopened = 1 → 0.2
    expect(b.reopenRate).toBeCloseTo(0.2, 3);
  });
});

describe("fail closed", () => {
  it("a ledger read error is UNAVAILABLE, never a zero burden", () => {
    const b = supportBurden({ tickets: [], activatedUsers: 100, paidUsers: 10, available: false });
    expect(b.state).toBe("unavailable");
    expect(b.contactsPer100Activated).toBeNull();
  });
});

describe("cohort scorecard integration", () => {
  const events: CohortEventRow[] = ["a", "b", "c", "d", "e"].map((u) => ({
    user_id: u,
    event: "checkin_completed",
    created_at: "2026-08-01T09:00:00Z",
  }));

  it("support_burden stays UNAVAILABLE with no ledger data", () => {
    const sc = buildCohortScorecard({ events, now: new Date("2026-08-11T12:00:00Z") });
    const row = sc.rows.find((r) => r.id === "support_burden")!;
    expect(row.state).toBe("unavailable");
  });

  it("support_burden becomes measured once the ledger reports burden", () => {
    const burden = supportBurden({
      tickets: [ticket({ dedupe_key: "i1", category: "billing", status: "open" })],
      activatedUsers: 5,
      paidUsers: 5,
    });
    const sc = buildCohortScorecard({
      events,
      supportBurden: burden,
      now: new Date("2026-08-11T12:00:00Z"),
    });
    const row = sc.rows.find((r) => r.id === "support_burden")!;
    expect(row.state).toBe("measured");
    expect(row.denominator).toBe(5);
    expect(row.action).toMatch(/block expansion/i); // unresolved billing present
  });
});
