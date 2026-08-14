/**
 * Canonical recurring-value cohort (MW-V17-07).
 *
 * ONE cohort definition, used by the report, admin export and expansion decision,
 * so a metric can never be computed two different ways. Every row is executable
 * from server-authoritative events — or explicitly UNAVAILABLE — and carries its
 * numerator, denominator, pending (not-yet-mature) count, suppression, maturity
 * rule and the predeclared decision action.
 *
 * Definitions (the metric dictionary, in code):
 *  - activation      = a user's FIRST `checkin_completed`, on its LOCAL calendar
 *                      day in that user's timezone (DST-correct).
 *  - dN_return       = of users MATURE for N days (activation day + (N-1) has
 *                      fully elapsed locally), the share with a `checkin_completed`
 *                      on the DISTINCT local calendar day activation+(N-1).
 *  - repair applied  = `plan_repair_completed`. There is NO preview event in the
 *                      product, so no preview→apply metric is reported.
 *  - repeat repair   = repairs applied on ≥2 DISTINCT local calendar days.
 *  - week closeout   = `weekly_reflection_completed`; distinct from `..._started`
 *                      (opened) and `carry_forward_saved` (carried forward).
 *  - renewal/refund/dispute = server-authoritative billing events; a first
 *                      renewal is only counted once the user is renewal-eligible.
 *  - support burden  = UNAVAILABLE: no privacy-safe ticket system exists yet.
 *
 * Pure module — no server-only imports, no clock of its own beyond the injected
 * `now` — so it is fully fixture-testable across timezones and DST.
 */

import { MIN_COHORT } from "@/lib/analytics/metrics";
import type { SupportBurden } from "@/lib/support/metrics";

/**
 * Metric-definition version. Bumped whenever a numerator/denominator/maturity
 * rule below changes, so an exported scorecard is self-describing and two
 * reports can be told apart when the math evolves (M05).
 */
export const COHORT_DEFINITION_VERSION = "m05.1";

export interface CohortEventRow {
  event: string;
  user_id: string | null;
  created_at: string;
}

/** A billing subscription row, for renewal eligibility. */
export interface CohortSubRow {
  user_id: string;
  status: string | null;
  trial_used_at?: string | null;
  current_period_end?: string | null;
}

export type MetricState = "measured" | "pending" | "unavailable";

export interface CohortRow {
  id: string;
  /** Plain-language definition, so the dashboard/export explain themselves. */
  definition: string;
  /** People who satisfy the metric (null when suppressed under MIN_COHORT). */
  numerator: number | null;
  /** Mature, eligible people the rate is over. */
  denominator: number;
  /** Eligible-but-not-yet-mature people, excluded from the denominator. */
  pending: number;
  /** numerator/denominator, suppressed (null) under MIN_COHORT. */
  rate: number | null;
  suppressed: boolean;
  state: MetricState;
  maturity: string;
  /** The predeclared action this row drives — never changed after seeing data. */
  action: string;
}

/** Local calendar date (YYYY-MM-DD) for an instant in a timezone. */
export function localDate(iso: string, timeZone: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  try {
    // en-CA formats as YYYY-MM-DD; the timezone makes it DST-correct.
    return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(t));
  } catch {
    return null;
  }
}

/** Days between two YYYY-MM-DD local dates (b - a), or NaN if malformed. */
function calendarDayDiff(a: string, b: string): number {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(da) || !Number.isFinite(db)) return NaN;
  return Math.round((db - da) / 86_400_000);
}

const tzFor = (userId: string, timezoneByUser: Record<string, string>): string =>
  timezoneByUser[userId] ?? "UTC";

/** Staff/test/demo users to exclude from cohort math. */
function isExcluded(userId: string, excluded: Set<string>): boolean {
  return excluded.has(userId);
}

function suppressRate(numerator: number, denominator: number): number | null {
  if (denominator < MIN_COHORT) return null;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

/**
 * Durable, full-history activation fact (M05). When supplied, activation and
 * D-N return are computed from these facts instead of from the (windowed) event
 * stream — so a user who activated before the reporting window still counts,
 * and lifetime-first facts are never inferred from a 30-day slice.
 */
export interface CanonicalActivationInput {
  /** user id -> immutable first-check-in instant (ISO). */
  activatedAtByUser: Record<string, string>;
  /** user id -> full-history local check-in days, for exact D-N return. */
  checkinLocalDaysByUser?: Record<string, string[]>;
}

export interface CohortInputs {
  events: CohortEventRow[];
  subs?: CohortSubRow[];
  /** Timezone per user id (IANA). Defaults to UTC when unknown. */
  timezoneByUser?: Record<string, string>;
  /** Staff/test/demo user ids to exclude entirely. */
  excludedUserIds?: string[];
  /** Durable activation facts; when present they override event-derived activation. */
  canonicalActivation?: CanonicalActivationInput;
  /**
   * MW-V18-08: privacy-safe support burden. When supplied (and not unavailable),
   * the support_burden row becomes measured instead of UNAVAILABLE.
   */
  supportBurden?: SupportBurden;
  /**
   * ISO instant the input data is current through (the freshest fact/event the
   * caller fetched). Reported as the source watermark so a stale pipeline is
   * distinguishable from a genuine zero.
   */
  sourceWatermark?: string;
  now?: Date;
}

export interface CohortScorecard {
  generatedAt: string;
  /** Metric-definition version these rows were computed under. */
  definitionVersion: string;
  /** Where activation came from: durable full-history facts, or the event window. */
  activationSource: "canonical_facts" | "event_window";
  /** ISO instant the underlying data is current through (null if unknown). */
  sourceWatermark: string | null;
  /**
   * Conservative UTC calendar date on or before which every local calendar day
   * is fully elapsed in every supported timezone (now − 48h). Any maturity a row
   * claims is guaranteed real up to this date; nothing after it is counted as a
   * miss.
   */
  matureThroughUtc: string;
  activatedUsers: number;
  rows: CohortRow[];
}

/**
 * Build the recurring-value scorecard from one cohort of activated users.
 */
export function buildCohortScorecard(inputs: CohortInputs): CohortScorecard {
  const now = inputs.now ?? new Date();
  const tzMap = inputs.timezoneByUser ?? {};
  const excluded = new Set(inputs.excludedUserIds ?? []);
  const nowIso = now.toISOString();

  // Index events per user (excluding staff/test), skipping user-less rows.
  const perUser = new Map<string, CohortEventRow[]>();
  for (const e of inputs.events) {
    if (!e.user_id || isExcluded(e.user_id, excluded)) continue;
    const list = perUser.get(e.user_id) ?? [];
    list.push(e);
    perUser.set(e.user_id, list);
  }

  // Activation: first check-in, as a local calendar day. Prefer the durable
  // full-history fact when the caller supplies it; otherwise fall back to
  // deriving it from the (windowed) event stream.
  const canonical = inputs.canonicalActivation;
  const activationDay = new Map<string, string>();
  if (canonical) {
    for (const [userId, iso] of Object.entries(canonical.activatedAtByUser)) {
      if (isExcluded(userId, excluded)) continue;
      const day = localDate(iso, tzFor(userId, tzMap));
      if (day) activationDay.set(userId, day);
    }
  } else {
    for (const [userId, evts] of perUser) {
      const tz = tzFor(userId, tzMap);
      let earliest: { t: number; day: string } | null = null;
      for (const e of evts) {
        if (e.event !== "checkin_completed") continue;
        const t = Date.parse(e.created_at);
        const day = localDate(e.created_at, tz);
        if (!Number.isFinite(t) || !day) continue;
        if (!earliest || t < earliest.t) earliest = { t, day };
      }
      if (earliest) activationDay.set(userId, earliest.day);
    }
  }

  const activatedUsers = activationDay.size;
  const todayLocal = (userId: string) => localDate(nowIso, tzFor(userId, tzMap))!;

  /** Distinct local calendar days a user fired `event`, in their timezone. */
  const distinctDays = (userId: string, event: string): Set<string> => {
    // Return (check-in) days come from the durable full-history fact when
    // present, so a return before the event window still counts.
    if (event === "checkin_completed" && canonical?.checkinLocalDaysByUser) {
      return new Set(canonical.checkinLocalDaysByUser[userId] ?? []);
    }
    const tz = tzFor(userId, tzMap);
    const days = new Set<string>();
    for (const e of perUser.get(userId) ?? []) {
      if (e.event !== event) continue;
      const d = localDate(e.created_at, tz);
      if (d) days.add(d);
    }
    return days;
  };

  // ---- dN return -------------------------------------------------------------
  // Mature for day N when activation + (N-1) has fully elapsed locally.
  const dReturn = (n: number): CohortRow => {
    let denominator = 0;
    let pending = 0;
    let numerator = 0;
    for (const [userId, aDay] of activationDay) {
      const elapsed = calendarDayDiff(aDay, todayLocal(userId));
      if (!Number.isFinite(elapsed)) continue;
      if (elapsed < n - 1) {
        pending++; // the target day has not fully passed yet
        continue;
      }
      denominator++;
      const targetDay = addDays(aDay, n - 1);
      if (distinctDays(userId, "checkin_completed").has(targetDay)) numerator++;
    }
    return row({
      id: `d${n}_return`,
      definition: `Returned (checkin_completed) on the distinct local calendar day ${n} of the cohort`,
      numerator,
      denominator,
      pending,
      maturity: `activation + ${n - 1} calendar day(s) fully elapsed in the user's timezone`,
      action: `If D${n} return is below target on a mature cohort, tighten the next-action loop before widening intake`,
    });
  };

  // ---- repair (apply / undo / repeat) ---------------------------------------
  const repairApplied = countUsersWith("plan_repair_completed");
  const repairUndone = countUsersWith("plan_repair_undone");
  let repeatRepair = 0;
  for (const userId of activationDay.keys()) {
    if (distinctDays(userId, "plan_repair_completed").size >= 2) repeatRepair++;
  }

  // ---- week (opened / closeout / carry-forward) -----------------------------
  const weekOpened = countUsersWith("weekly_reflection_started");
  const weekCloseout = countUsersWith("weekly_reflection_completed");
  const carryForward = countUsersWith("carry_forward_saved");

  // ---- billing (conversion / renewal / refund / dispute) --------------------
  const converted = countUsersWith("trial_converted");
  const refunded = countUsersWith("payment_refunded");
  const disputed = countUsersWith("payment_disputed");

  // First renewal only counts renewal-eligible users (period end passed).
  const subs = inputs.subs ?? [];
  let renewalEligible = 0;
  let renewalPending = 0;
  let renewed = 0;
  const renewedUsers = usersWith("subscription_renewed");
  for (const s of subs) {
    if (isExcluded(s.user_id, excluded)) continue;
    if (!s.trial_used_at) continue; // never a payer
    const periodEnd = s.current_period_end ? Date.parse(s.current_period_end) : NaN;
    if (!Number.isFinite(periodEnd)) {
      renewalPending++;
      continue;
    }
    if (periodEnd > now.getTime()) {
      renewalPending++; // not yet due to renew
      continue;
    }
    renewalEligible++;
    if (renewedUsers.has(s.user_id)) renewed++;
  }

  const rows: CohortRow[] = [
    dReturn(2),
    dReturn(3),
    row({
      id: "repair_applied",
      definition: "Applied a remaining-day repair (plan_repair_completed). No preview event exists, so no preview→apply funnel is reported.",
      numerator: repairApplied,
      denominator: activatedUsers,
      pending: 0,
      maturity: "any time after activation",
      action: "Low repair usage on an active cohort means the adaptive-day value is not landing — investigate the Adjust entry point",
    }),
    row({
      id: "repair_undone",
      definition: "Undid an applied repair (plan_repair_undone) — Undo is free and must not be penalised",
      numerator: repairUndone,
      denominator: activatedUsers,
      pending: 0,
      maturity: "any time after activation",
      action: "High undo rate is a signal the reshape is unwanted, not a failure to charge for",
    }),
    row({
      id: "repeat_repair_distinct_day",
      definition: "Applied repairs on ≥2 DISTINCT local calendar days — the durable repeat-value signal",
      numerator: repeatRepair,
      denominator: activatedUsers,
      pending: 0,
      maturity: "≥2 distinct local days observed",
      action: "This is the core repeat-value proof; it must be mature before public-paid expansion",
    }),
    row({
      id: "week_opened",
      definition: "Opened the weekly closeout (weekly_reflection_started)",
      numerator: weekOpened,
      denominator: activatedUsers,
      pending: 0,
      maturity: "reached a first week",
      action: "Opened ≠ completed; compare against closeout to find where the week drops",
    }),
    row({
      id: "week_closeout_completed",
      definition: "Completed the weekly closeout (weekly_reflection_completed)",
      numerator: weekCloseout,
      denominator: activatedUsers,
      pending: 0,
      maturity: "reached and finished a first week",
      action: "Closeout completion is the week-continuity gate for expansion",
    }),
    row({
      id: "carry_forward_accepted",
      definition: "Carried a decision into next week (carry_forward_saved)",
      numerator: carryForward,
      denominator: weekCloseout,
      pending: 0,
      maturity: "second-week maturity (a closeout must precede carry-forward)",
      action: "Carry-forward off a completed closeout is the strongest continuity signal",
    }),
    row({
      id: "trial_converted",
      definition: "Trial converted to a first charge (trial_converted)",
      numerator: converted,
      denominator: activatedUsers,
      pending: 0,
      maturity: "trial decision reached",
      action: "Conversion gates public-paid, but never above the observed-live-money gate",
    }),
    renewalRow(renewed, renewalEligible, renewalPending),
    row({
      id: "refund",
      definition: "Payments refunded (payment_refunded), server-authoritative",
      numerator: refunded,
      denominator: converted,
      pending: 0,
      maturity: "any refund in window",
      action: "Any refund/dispute above threshold fails closed on expansion",
    }),
    row({
      id: "dispute",
      definition: "Payments disputed (payment_disputed), server-authoritative",
      numerator: disputed,
      denominator: converted,
      pending: 0,
      maturity: "any dispute in window",
      action: "Any open dispute blocks expansion until resolved",
    }),
    supportBurdenRow(inputs.supportBurden),
  ];

  // now − 48h is safely past the end of any local calendar day that began up to
  // ~26h ago across every IANA offset, so it is a conservative "fully elapsed
  // everywhere" floor for maturity claims.
  const matureThroughUtc = localDate(
    new Date(now.getTime() - 48 * 3_600_000).toISOString(),
    "UTC"
  )!;

  return {
    generatedAt: now.toISOString(),
    definitionVersion: COHORT_DEFINITION_VERSION,
    activationSource: canonical ? "canonical_facts" : "event_window",
    sourceWatermark: inputs.sourceWatermark ?? null,
    matureThroughUtc,
    activatedUsers,
    rows,
  };

  // --- local helpers (close over perUser/activation) ------------------------
  function usersWith(event: string): Set<string> {
    const s = new Set<string>();
    for (const [userId, evts] of perUser) {
      if (evts.some((e) => e.event === event)) s.add(userId);
    }
    return s;
  }
  function countUsersWith(event: string): number {
    return usersWith(event).size;
  }
}

function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + n * 86_400_000;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(new Date(t));
}

function row(input: {
  id: string;
  definition: string;
  numerator: number;
  denominator: number;
  pending: number;
  maturity: string;
  action: string;
}): CohortRow {
  const suppressed = input.denominator < MIN_COHORT;
  return {
    id: input.id,
    definition: input.definition,
    numerator: suppressed ? null : input.numerator,
    denominator: input.denominator,
    pending: input.pending,
    rate: suppressRate(input.numerator, input.denominator),
    suppressed,
    state: input.denominator === 0 && input.pending > 0 ? "pending" : "measured",
    maturity: input.maturity,
    action: input.action,
  };
}

function renewalRow(renewed: number, eligible: number, pending: number): CohortRow {
  const suppressed = eligible < MIN_COHORT;
  return {
    id: "first_renewal",
    definition:
      "First renewal among renewal-eligible payers (period end passed). Users before their renewal date are pending, never counted as a failed renewal.",
    numerator: suppressed ? null : renewed,
    denominator: eligible,
    pending,
    rate: suppressRate(renewed, eligible),
    suppressed,
    state: eligible === 0 && pending > 0 ? "pending" : "measured",
    maturity: "subscription current_period_end has passed",
    action: "First-renewal evidence must be mature (not pending) before public-paid 9.5",
  };
}

/**
 * MW-V18-08: the support-burden row. UNAVAILABLE until the privacy-safe ledger
 * (support_tickets) has data; then it reports deduped contacts over activated
 * users, with medians and unresolved safety/billing surfaced in the definition.
 * A ledger read error arrives as an unavailable summary and stays UNAVAILABLE —
 * never a fabricated zero.
 */
function supportBurdenRow(summary: SupportBurden | undefined): CohortRow {
  if (!summary || summary.state === "unavailable") {
    return unavailableRow(
      "support_burden",
      "Support tickets/categories per active user",
      summary?.state === "unavailable"
        ? "The support ledger could not be read, so this is UNAVAILABLE rather than a fabricated zero."
        : "No privacy-safe ticket/category data yet (support_tickets is empty), so this is UNAVAILABLE rather than a fabricated zero. Import from the support inbox via the admin ledger — no message content is stored.",
      "Feed the support inbox into the privacy-safe ledger before claiming a low support burden",
    );
  }
  const suppressed = summary.activatedUsers < MIN_COHORT;
  const per100 = summary.contactsPer100Activated;
  return {
    id: "support_burden",
    definition:
      `Deduped support contacts per active user (privacy-safe ledger, no message content). ` +
      `${summary.contacts} issue(s); ` +
      `${per100 === null ? "per-100 suppressed" : `${per100}/100 activated`}; ` +
      `median first response ${summary.medianFirstResponseMin ?? "—"} min, ` +
      `resolution ${summary.medianResolutionMin ?? "—"} min; ` +
      `${summary.unresolvedCritical} unresolved safety/billing/deletion.`,
    numerator: suppressed ? null : summary.contacts,
    denominator: summary.activatedUsers,
    pending: 0,
    rate: suppressRate(summary.contacts, summary.activatedUsers),
    suppressed,
    state: "measured",
    maturity: "any support contact in window; denominator is activated users",
    action:
      summary.unresolvedCritical > 0
        ? "Unresolved safety/billing/deletion contacts block expansion until cleared"
        : "Track support load per 100 activated users against the beta threshold",
  };
}

function unavailableRow(
  id: string,
  definition: string,
  maturity: string,
  action: string,
): CohortRow {
  return {
    id,
    definition,
    numerator: null,
    denominator: 0,
    pending: 0,
    rate: null,
    suppressed: false,
    state: "unavailable",
    maturity,
    action,
  };
}
