import { FUNNELS, type AppEvent, type FunnelName } from "@/lib/analytics/taxonomy";

/**
 * Decision-ready metrics (Launch & Scale v6, Prompt 10). Pure module — every
 * function is a deterministic transform of already-fetched rows, so metrics are
 * reproducible and fixture-testable, and reconcile against server-authoritative
 * billing/generation records.
 *
 * Small-cohort suppression: any figure derived from fewer than MIN_COHORT
 * distinct people is returned as null so a dashboard can never expose an
 * individual.
 */

export const MIN_COHORT = 5;

export interface EventRow {
  event: string;
  user_id: string | null;
  anon_id?: string | null;
  created_at: string;
}

export interface SubRow {
  user_id: string;
  status: string | null;
  plan_name: string | null;
  trial_used_at?: string | null;
  cancel_at_period_end?: boolean | null;
  created_at: string;
}

export interface CostRow {
  estimated_cost_usd: number | string | null;
  created_at: string;
}

/** Identity used for uniqueness: the user if known, else the anonymous id. */
function subject(r: EventRow): string | null {
  return r.user_id ?? r.anon_id ?? null;
}

function distinctSubjects(rows: EventRow[], event: string): Set<string> {
  const s = new Set<string>();
  for (const r of rows) {
    if (r.event !== event) continue;
    const id = subject(r);
    if (id) s.add(id);
  }
  return s;
}

/** Suppress a value computed from fewer than MIN_COHORT people. */
export function suppress<T>(value: T, cohortSize: number): T | null {
  return cohortSize >= MIN_COHORT ? value : null;
}

export interface FunnelStep {
  event: AppEvent;
  reached: number;
  /** Conversion from the previous step, or null (suppressed / first step). */
  stepRate: number | null;
}

/**
 * Reconstruct a funnel: distinct subjects who reached each step, and the
 * step-over-step conversion. No double-counting — a subject counts once per
 * step regardless of repeats.
 */
export function funnelConversion(rows: EventRow[], funnel: FunnelName): FunnelStep[] {
  const steps = FUNNELS[funnel];
  let prev: number | null = null;
  return steps.map((event) => {
    const reached = distinctSubjects(rows, event).size;
    const stepRate =
      prev === null || prev < MIN_COHORT ? null : round(reached / prev);
    prev = reached;
    return { event, reached, stepRate };
  });
}

/** sample→trial and trial→paid, suppressed under MIN_COHORT denominators. */
export function conversionRate(
  rows: EventRow[],
  from: AppEvent,
  to: AppEvent
): { from: number; to: number; rate: number | null } {
  const fromN = distinctSubjects(rows, from).size;
  const toN = distinctSubjects(rows, to).size;
  return { from: fromN, to: toN, rate: suppress(round(toN / (fromN || 1)), fromN) };
}

/**
 * D1/D7/D30 retained activation: of subjects whose activation event happened in
 * the window, the share with any return event N days later (±1 day bucket).
 */
export function retention(
  rows: EventRow[],
  activationEvent: AppEvent,
  returnEvents: AppEvent[],
  days: number
): number | null {
  const activatedAt = new Map<string, number>();
  for (const r of rows) {
    if (r.event !== activationEvent) continue;
    const id = subject(r);
    if (id) activatedAt.set(id, Math.min(activatedAt.get(id) ?? Infinity, ts(r.created_at)));
  }
  if (activatedAt.size < MIN_COHORT) return null;
  const window = 24 * 3600 * 1000;
  const lo = days * window - window;
  const hi = days * window + window;
  const ret = new Set<AppEvent>(returnEvents);
  let retained = 0;
  for (const [id, start] of activatedAt) {
    const back = rows.some(
      (r) => subject(r) === id && ret.has(r.event as AppEvent) && ts(r.created_at) - start >= lo && ts(r.created_at) - start <= hi
    );
    if (back) retained += 1;
  }
  return round(retained / activatedAt.size);
}

export interface Churn {
  voluntary: number;
  involuntary: number;
}

/** Voluntary = user-initiated cancels; involuntary = payment failures. */
export function churnCounts(rows: EventRow[]): Churn {
  return {
    voluntary: distinctSubjects(rows, "trial_canceled").size,
    involuntary: distinctSubjects(rows, "payment_failed").size,
  };
}

// --- Unit economics ----------------------------------------------------------

/** Published prices (EUR). Kept here so revenue estimates are explicit. */
export const PLAN_PRICE_EUR: Record<string, number> = {
  pro_monthly: 9.99,
  pro_yearly: 59.99,
};
/** Monthly-normalized revenue so intervals are comparable. */
const MONTHLY_FACTOR: Record<string, number> = {
  pro_monthly: 1,
  pro_yearly: 1 / 12,
};

export interface UnitEconomics {
  activePayers: number;
  /** Estimated monthly-normalized gross revenue, EUR. Excludes Stripe fees. */
  mrrEur: number | null;
  aiCostEur: number | null;
  /** Estimated monthly gross contribution per active payer, EUR. */
  contributionPerUserEur: number | null;
  /** Truthfulness note: what this estimate does and does not include. */
  note: string;
}

/**
 * Estimate monthly gross contribution per active payer. Revenue is derived from
 * active/trialing paid subscriptions at published prices; cost is the actual AI
 * ledger. Stripe fees and refunds are NOT in the DB — excluded and flagged, so
 * the number is never presented as net margin.
 */
export function unitEconomics(subs: SubRow[], costs: CostRow[], eurPerUsd = 0.92): UnitEconomics {
  const payers = subs.filter(
    (s) => s.status === "active" && (s.plan_name === "pro_monthly" || s.plan_name === "pro_yearly")
  );
  const mrr = payers.reduce(
    (sum, s) => sum + (PLAN_PRICE_EUR[s.plan_name!] ?? 0) * (MONTHLY_FACTOR[s.plan_name!] ?? 0),
    0
  );
  const aiUsd = costs.reduce((sum, c) => sum + Number(c.estimated_cost_usd ?? 0), 0);
  const aiEur = aiUsd * eurPerUsd;
  const n = payers.length;
  return {
    activePayers: n,
    mrrEur: suppress(round2(mrr), n),
    aiCostEur: suppress(round2(aiEur), n),
    contributionPerUserEur: suppress(round2((mrr - aiEur) / (n || 1)), n),
    note: "Estimate at published prices; excludes Stripe fees and refunds.",
  };
}

// --- Generation health (schema-limited; latency/model in LS-11) --------------

export interface GenerationHealth {
  generated: number;
  fallbackServed: number;
  safetyBlocked: number;
  fallbackRate: number | null;
}

/**
 * Generation outcomes derivable from the current ledgers. Latency and
 * per-model/prompt-version breakdown require the richer telemetry added in
 * LS-11, so they are intentionally absent here.
 */
export function generationHealth(events: EventRow[], safetyBlockedCount: number): GenerationHealth {
  const generated = events.filter((r) => r.event === "plan_generated").length;
  const fallback = events.filter((r) => r.event === "plan_fallback_served").length;
  const attempts = generated + fallback;
  return {
    generated,
    fallbackServed: fallback,
    safetyBlocked: safetyBlockedCount,
    fallbackRate: attempts >= MIN_COHORT ? round(fallback / attempts) : null,
  };
}

// --- Reconciliation & anomalies ----------------------------------------------

export interface Reconciliation {
  metric: string;
  fromEvents: number;
  fromSystem: number;
  reconciled: boolean;
}

/**
 * Counts derived from app_events must agree with server-authoritative records.
 * A mismatch means an event is missing or double-fired — surfaced, never hidden.
 */
export function reconcile(
  eventCount: number,
  systemCount: number,
  metric: string,
  tolerance = 0
): Reconciliation {
  return {
    metric,
    fromEvents: eventCount,
    fromSystem: systemCount,
    reconciled: Math.abs(eventCount - systemCount) <= tolerance,
  };
}

export interface Anomaly {
  metric: string;
  current: number;
  baseline: number;
  dropPct: number;
}

/**
 * Flag a major funnel drop: current below baseline by more than `dropThreshold`
 * (default 40%), when the baseline cohort is meaningful.
 */
export function detectAnomalies(
  current: Record<string, number>,
  baseline: Record<string, number>,
  dropThreshold = 0.4
): Anomaly[] {
  const out: Anomaly[] = [];
  for (const [metric, base] of Object.entries(baseline)) {
    if (base < MIN_COHORT) continue;
    const cur = current[metric] ?? 0;
    const dropPct = round((base - cur) / base);
    if (dropPct >= dropThreshold) out.push({ metric, current: cur, baseline: base, dropPct });
  }
  return out;
}

// --- helpers -----------------------------------------------------------------

function ts(iso: string): number {
  return new Date(iso).getTime();
}
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
