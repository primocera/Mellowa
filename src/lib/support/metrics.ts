import { MIN_COHORT } from "@/lib/analytics/metrics";
import {
  CRITICAL_AREAS,
  RESOLVED_STATUSES,
  type SupportCategory,
  type SupportStatus,
} from "@/lib/support/taxonomy";

/**
 * MW-V18-08: support-burden metrics. Pure transform of ledger rows into decision
 * numbers — contacts per 100 users, median time-to-first-response and
 * time-to-resolution, reopen rate, and unresolved safety/billing/deletion count.
 *
 * Privacy by construction: the input rows carry no message content, and every
 * output is an aggregate. Staff/test/demo ids (the M05 server-owned registry)
 * are excluded so support load is measured over real users only.
 */

export interface SupportTicketRow {
  dedupe_key: string;
  account_user_id: string | null;
  category: SupportCategory;
  status: SupportStatus;
  reopened_count: number | null;
  first_response_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

export type BurdenState = "measured" | "suppressed" | "unavailable";

export interface SupportBurden {
  state: BurdenState;
  /** Distinct issues (deduped by dedupe_key), after excluding staff/test. */
  contacts: number;
  /** Contacts per 100 activated users; null when the denominator is too small. */
  contactsPer100Activated: number | null;
  /** Contacts per 100 paid users; null when the denominator is too small. */
  contactsPer100Paid: number | null;
  activatedUsers: number;
  paidUsers: number;
  /** Median minutes to first response / resolution, over tickets that have one. */
  medianFirstResponseMin: number | null;
  medianResolutionMin: number | null;
  /** Reopened issues ÷ resolved-or-closed issues. */
  reopenRate: number | null;
  /** Still-open issues in safety/billing/account_deletion — a launch signal. */
  unresolvedCritical: number;
  /** Per-category contact counts (deduped). */
  byCategory: Record<string, number>;
}

export interface SupportBurdenInputs {
  tickets: SupportTicketRow[];
  activatedUsers: number;
  paidUsers: number;
  excludedUserIds?: string[];
  /**
   * When false, the ledger could not be read: the burden is UNAVAILABLE, never a
   * fabricated zero (a query error must not read as "no support load").
   */
  available?: boolean;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const m = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return Math.round(m);
}

const minutesBetween = (a: string, b: string): number | null => {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb) || tb < ta) return null;
  return (tb - ta) / 60_000;
};

export function supportBurden(inputs: SupportBurdenInputs): SupportBurden {
  const excluded = new Set(inputs.excludedUserIds ?? []);
  const empty = (state: BurdenState): SupportBurden => ({
    state,
    contacts: 0,
    contactsPer100Activated: null,
    contactsPer100Paid: null,
    activatedUsers: inputs.activatedUsers,
    paidUsers: inputs.paidUsers,
    medianFirstResponseMin: null,
    medianResolutionMin: null,
    reopenRate: null,
    unresolvedCritical: 0,
    byCategory: {},
  });

  if (inputs.available === false) return empty("unavailable");

  // Exclude staff/test/demo, then dedupe by issue (dedupe_key) — repeated
  // contacts about one issue count once.
  const byIssue = new Map<string, SupportTicketRow>();
  for (const t of inputs.tickets) {
    if (t.account_user_id && excluded.has(t.account_user_id)) continue;
    // Keep the most-progressed row per issue (latest created_at wins).
    const prev = byIssue.get(t.dedupe_key);
    if (!prev || Date.parse(t.created_at) >= Date.parse(prev.created_at)) {
      byIssue.set(t.dedupe_key, t);
    }
  }
  const issues = [...byIssue.values()];

  const byCategory: Record<string, number> = {};
  const ttfr: number[] = [];
  const ttr: number[] = [];
  let reopened = 0;
  let resolvedOrClosed = 0;
  let unresolvedCritical = 0;

  for (const t of issues) {
    byCategory[t.category] = (byCategory[t.category] ?? 0) + 1;
    if (t.first_response_at) {
      const m = minutesBetween(t.created_at, t.first_response_at);
      if (m !== null) ttfr.push(m);
    }
    if (t.resolved_at) {
      const m = minutesBetween(t.created_at, t.resolved_at);
      if (m !== null) ttr.push(m);
    }
    const isResolved = RESOLVED_STATUSES.includes(t.status);
    if (isResolved) resolvedOrClosed += 1;
    if ((t.reopened_count ?? 0) > 0 || t.status === "reopened") reopened += 1;
    if (!isResolved && CRITICAL_AREAS.includes(t.category)) unresolvedCritical += 1;
  }

  const contacts = issues.length;
  const per100 = (denom: number): number | null =>
    denom >= MIN_COHORT ? Math.round((contacts / denom) * 1000) / 10 : null;

  return {
    state: contacts === 0 ? "measured" : "measured",
    contacts,
    contactsPer100Activated: per100(inputs.activatedUsers),
    contactsPer100Paid: per100(inputs.paidUsers),
    activatedUsers: inputs.activatedUsers,
    paidUsers: inputs.paidUsers,
    medianFirstResponseMin: median(ttfr),
    medianResolutionMin: median(ttr),
    reopenRate: resolvedOrClosed >= MIN_COHORT ? Math.round((reopened / resolvedOrClosed) * 1000) / 1000 : null,
    unresolvedCritical,
    byCategory,
  };
}
