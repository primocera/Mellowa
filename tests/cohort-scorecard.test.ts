import { describe, expect, it } from "vitest";
import { buildCohortScorecard, localDate, type CohortEventRow } from "@/lib/analytics/cohort";

/**
 * MW-V17-07: the recurring-value scorecard is computed from ONE canonical cohort,
 * with exact distinct-local-calendar-day D2/D3, honest maturity/pending,
 * MIN_COHORT suppression, staff exclusion, timezone/DST correctness, and no
 * invented preview metric. Support burden is UNAVAILABLE, never a fabricated zero.
 */

const NOW = new Date("2026-08-11T12:00:00Z");
const ev = (user_id: string, event: string, day: string, time = "09:00:00"): CohortEventRow => ({
  user_id,
  event,
  created_at: `${day}T${time}Z`,
});
const rowOf = (rows: ReturnType<typeof buildCohortScorecard>["rows"], id: string) =>
  rows.find((r) => r.id === id)!;

describe("localDate is DST/timezone correct", () => {
  it("buckets an instant into the user's local calendar day", () => {
    // 2026-08-01T12:00Z is already 2026-08-02 in UTC+14.
    expect(localDate("2026-08-01T12:00:00Z", "Pacific/Kiritimati")).toBe("2026-08-02");
    expect(localDate("2026-08-01T12:00:00Z", "UTC")).toBe("2026-08-01");
  });
});

describe("D2/D3 return on distinct local calendar days", () => {
  // Six users activate on 08-01 (all mature for D2 and D3 by 08-11).
  const users = ["u1", "u2", "u3", "u4", "u5", "u6"];
  const events: CohortEventRow[] = [];
  for (const u of users) events.push(ev(u, "checkin_completed", "2026-08-01"));
  // Four return on 08-02 (D2), two of them again on 08-03 (D3).
  for (const u of ["u1", "u2", "u3", "u4"]) events.push(ev(u, "checkin_completed", "2026-08-02"));
  for (const u of ["u1", "u2"]) events.push(ev(u, "checkin_completed", "2026-08-03"));
  // A seventh user activates TODAY → immature for D2/D3 (pending, not a miss).
  events.push(ev("u7", "checkin_completed", "2026-08-11"));

  const sc = buildCohortScorecard({ events, now: NOW });

  it("counts activated users including the immature one", () => {
    expect(sc.activatedUsers).toBe(7);
  });

  it("D2 = 4/6 over the mature cohort, with the immature user pending", () => {
    const d2 = rowOf(sc.rows, "d2_return");
    expect(d2.denominator).toBe(6);
    expect(d2.pending).toBe(1);
    expect(d2.numerator).toBe(4);
    expect(d2.rate).toBeCloseTo(0.667, 2);
    expect(d2.state).toBe("measured");
  });

  it("D3 = 2/6, distinct calendar day 3 only", () => {
    const d3 = rowOf(sc.rows, "d3_return");
    expect(d3.numerator).toBe(2);
    expect(d3.denominator).toBe(6);
  });
});

describe("maturity: an all-immature cohort is pending, not zero", () => {
  const events = ["a", "b", "c", "d", "e"].map((u) => ev(u, "checkin_completed", "2026-08-11"));
  const sc = buildCohortScorecard({ events, now: NOW });
  it("D2 denominator is 0 and the row is pending", () => {
    const d2 = rowOf(sc.rows, "d2_return");
    expect(d2.denominator).toBe(0);
    expect(d2.pending).toBe(5);
    expect(d2.state).toBe("pending");
    expect(d2.rate).toBeNull();
  });
});

describe("MIN_COHORT suppression", () => {
  it("a sub-5 mature cohort suppresses the rate but shows the denominator", () => {
    const events = ["a", "b", "c"].map((u) => ev(u, "checkin_completed", "2026-08-01"));
    const sc = buildCohortScorecard({ events, now: NOW });
    const d2 = rowOf(sc.rows, "d2_return");
    expect(d2.denominator).toBe(3);
    expect(d2.suppressed).toBe(true);
    expect(d2.numerator).toBeNull();
    expect(d2.rate).toBeNull();
  });
});

describe("staff/test users are excluded", () => {
  it("excluded ids do not enter activation or any numerator", () => {
    const events = [
      ...["a", "b", "c", "d", "e"].map((u) => ev(u, "checkin_completed", "2026-08-01")),
      ev("staff", "checkin_completed", "2026-08-01"),
      ev("staff", "plan_repair_completed", "2026-08-02"),
    ];
    const sc = buildCohortScorecard({ events, excludedUserIds: ["staff"], now: NOW });
    expect(sc.activatedUsers).toBe(5);
    expect(rowOf(sc.rows, "repair_applied").numerator).toBe(0);
  });
});

describe("repair: apply / undo / distinct-day repeat, no preview metric", () => {
  const base = ["a", "b", "c", "d", "e"].map((u) => ev(u, "checkin_completed", "2026-08-01"));
  const events = [
    ...base,
    ev("a", "plan_repair_completed", "2026-08-01"),
    ev("a", "plan_repair_completed", "2026-08-03"), // 2 distinct days → repeat
    ev("b", "plan_repair_completed", "2026-08-01"),
    ev("b", "plan_repair_completed", "2026-08-01", "18:00:00"), // same day, not repeat
    ev("a", "plan_repair_undone", "2026-08-01"),
  ];
  const sc = buildCohortScorecard({ events, now: NOW });

  it("counts repair applied and undone users", () => {
    expect(rowOf(sc.rows, "repair_applied").numerator).toBe(2);
    expect(rowOf(sc.rows, "repair_undone").numerator).toBe(1);
  });
  it("repeat repair requires ≥2 DISTINCT local days", () => {
    expect(rowOf(sc.rows, "repeat_repair_distinct_day").numerator).toBe(1); // only 'a'
  });
  it("reports no preview→apply metric (no preview event exists)", () => {
    expect(sc.rows.some((r) => /preview/i.test(r.id))).toBe(false);
  });
});

describe("Week: opened, closeout and carry-forward are separate behaviors", () => {
  const base = ["a", "b", "c", "d", "e"].map((u) => ev(u, "checkin_completed", "2026-08-01"));
  const events = [
    ...base,
    ev("a", "weekly_reflection_started", "2026-08-08"),
    ev("b", "weekly_reflection_started", "2026-08-08"),
    ev("a", "weekly_reflection_completed", "2026-08-08"),
    ev("a", "carry_forward_saved", "2026-08-08"),
  ];
  const sc = buildCohortScorecard({ events, now: NOW });
  it("opened (2) ≠ closeout (1)", () => {
    expect(rowOf(sc.rows, "week_opened").numerator).toBe(2);
    expect(rowOf(sc.rows, "week_closeout_completed").numerator).toBe(1);
  });
  it("carry-forward denominator is completed closeouts (suppressed under MIN_COHORT)", () => {
    const cf = rowOf(sc.rows, "carry_forward_accepted");
    // Denominator is the closeout count (1), which is < MIN_COHORT, so the rate
    // is suppressed rather than shown as a misleading 1/1.
    expect(cf.denominator).toBe(1);
    expect(cf.suppressed).toBe(true);
    expect(cf.numerator).toBeNull();
  });
});

describe("billing: first renewal counts only renewal-eligible payers", () => {
  const events = [
    ...["a", "b", "c", "d", "e"].map((u) => ev(u, "checkin_completed", "2026-08-01")),
    ev("a", "subscription_renewed", "2026-08-10"),
    ev("b", "payment_refunded", "2026-08-10"),
    ev("c", "trial_converted", "2026-08-05"),
  ];
  const subs = [
    // eligible: period end passed, renewed
    { user_id: "a", status: "active", trial_used_at: "2026-07-01T00:00:00Z", current_period_end: "2026-08-01T00:00:00Z" },
    // eligible: period end passed, not renewed
    { user_id: "b", status: "active", trial_used_at: "2026-07-01T00:00:00Z", current_period_end: "2026-08-05T00:00:00Z" },
    // pending: period end in the future — never counted as a failed renewal
    { user_id: "c", status: "active", trial_used_at: "2026-07-20T00:00:00Z", current_period_end: "2026-09-01T00:00:00Z" },
    // never a payer (no trial) — excluded
    { user_id: "d", status: "sample", trial_used_at: null, current_period_end: null },
  ];
  const sc = buildCohortScorecard({ events, subs, now: NOW });
  it("renewal-eligible = 2 (a,b); pending = 1 (c)", () => {
    const r = rowOf(sc.rows, "first_renewal");
    expect(r.denominator).toBe(2);
    expect(r.pending).toBe(1);
    expect(r.numerator).toBeNull(); // <5 eligible → suppressed
  });
  it("refund and dispute are server-authoritative and present", () => {
    expect(rowOf(sc.rows, "refund").numerator).toBeDefined();
    expect(rowOf(sc.rows, "dispute")).toBeTruthy();
  });
});

describe("support burden is UNAVAILABLE, not a fabricated zero", () => {
  it("reports state unavailable with a null value and a collection path", () => {
    const events = ["a", "b", "c", "d", "e"].map((u) => ev(u, "checkin_completed", "2026-08-01"));
    const sc = buildCohortScorecard({ events, now: NOW });
    const s = rowOf(sc.rows, "support_burden");
    expect(s.state).toBe("unavailable");
    expect(s.numerator).toBeNull();
    expect(s.rate).toBeNull();
    expect(s.definition).toMatch(/ticket/i);
  });
});
