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
  /** MW-V10-02: pinned trial-length cohort, when the row has one. */
  trial_variant?: string | null;
  trial_days?: number | null;
}

export interface CostRow {
  estimated_cost_usd: number | string | null;
  created_at: string;
}

/** One AI ledger row with the fields the cost scorecard needs. */
export interface UsageRow {
  user_id: string | null;
  status: string | null;
  estimated_cost_usd: number | string | null;
  actual_cost_usd?: number | string | null;
}

export interface UsageScorecard {
  /** Generations counted per user (excludes released reservations). */
  generationsP50: number | null;
  generationsP90: number | null;
  /** Users above the high-use threshold in the window. */
  highUseUsers: number;
  highUseThreshold: number;
  /** Global daily spend-ceiling denials seen in the window. */
  ceilingDenials: number;
  /** Actual-or-estimated total USD across the window. */
  totalCostUsd: number;
  activeUsers: number;
}

function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.ceil(p * sortedAsc.length) - 1);
  return sortedAsc[Math.max(0, idx)];
}

const rowCost = (r: UsageRow): number =>
  Number(r.actual_cost_usd ?? r.estimated_cost_usd ?? 0);

/**
 * MW-V9-10: per-user generation and cost distribution for the admin scorecard.
 * Released reservations (no provider call) don't count as generations. "Ceiling
 * denials" are surfaced from a separate count because a denied claim never
 * writes a ledger row. Internal IDs and bands only — never user content.
 */
export function usageScorecard(
  rows: UsageRow[],
  ceilingDenials: number,
  highUseThreshold = 90
): UsageScorecard {
  const perUser = new Map<string, number>();
  let totalCostUsd = 0;
  for (const r of rows) {
    if (r.status === "released") continue;
    totalCostUsd += rowCost(r);
    const id = r.user_id;
    if (id) perUser.set(id, (perUser.get(id) ?? 0) + 1);
  }
  const counts = [...perUser.values()].sort((a, b) => a - b);
  const highUseUsers = counts.filter((c) => c >= highUseThreshold).length;
  return {
    generationsP50: percentile(counts, 0.5),
    generationsP90: percentile(counts, 0.9),
    highUseUsers,
    highUseThreshold,
    ceilingDenials,
    totalCostUsd: round2(totalCostUsd),
    activeUsers: perUser.size,
  };
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

// --- MW-V10-06: cost per outcome ---------------------------------------------

/**
 * What one unit of progress actually costs. `null` means **unknown**, and is
 * returned whenever the denominator is zero or the cohort is too small to read.
 *
 * The distinction that matters: a cost of `0` means we spent nothing; `null`
 * means we do not know. Rendering an unknown as zero is how a beta convinces
 * itself the economics work, so the two are never collapsed.
 */
export interface CostPerOutcome {
  /** AI spend ÷ samples generated. */
  perSampleUsd: number | null;
  /** AI spend ÷ trials started — the cost of getting one person to intent. */
  perActivatedTrialUsd: number | null;
  /** AI spend ÷ people who renewed — the only number that meets revenue. */
  perRetainedPayerUsd: number | null;
  /** Mean spend among users above the high-use threshold. */
  perHighUseUserUsd: number | null;
  /** Total AI spend in the window, for reference. */
  totalCostUsd: number;
  /**
   * Every input we could not observe, named. An empty list means every figure
   * above is derived from real ledger rows.
   */
  unknowns: string[];
}

export function costPerOutcome(
  usage: UsageRow[],
  counts: {
    samplesGenerated: number;
    trialsStarted: number;
    retainedPayers: number;
  },
  highUseThreshold = 90
): CostPerOutcome {
  const unknowns: string[] = [];
  let total = 0;
  const perUser = new Map<string, { cost: number; generations: number }>();

  for (const r of usage) {
    if (r.status === "released") continue; // reservation, no provider call
    const cost = rowCost(r);
    total += cost;
    if (r.user_id) {
      const cur = perUser.get(r.user_id) ?? { cost: 0, generations: 0 };
      cur.cost += cost;
      cur.generations += 1;
      perUser.set(r.user_id, cur);
    }
  }

  // Provider fees, Stripe fees and infrastructure are not in this ledger. Say
  // so rather than presenting an AI-only number as the cost of the business.
  unknowns.push("Stripe fees and infrastructure are not in the AI ledger");

  const div = (numerator: number, denominator: number, label: string): number | null => {
    if (denominator <= 0) {
      unknowns.push(`${label}: no ${label.split(" per ")[1] ?? "denominator"} in window`);
      return null;
    }
    return round2(numerator / denominator);
  };

  const highUse = [...perUser.values()].filter(
    (u) => u.generations >= highUseThreshold
  );

  return {
    perSampleUsd: div(total, counts.samplesGenerated, "cost per sample"),
    perActivatedTrialUsd: div(total, counts.trialsStarted, "cost per activated trial"),
    perRetainedPayerUsd: div(total, counts.retainedPayers, "cost per retained payer"),
    perHighUseUserUsd:
      highUse.length === 0
        ? null
        : round2(highUse.reduce((a, u) => a + u.cost, 0) / highUse.length),
    totalCostUsd: round2(total),
    unknowns,
  };
}

// --- MW-V10-05: email backlog and dead letters -------------------------------

/**
 * One `email_deliveries` row, reduced to what an operator may see. Deliberately
 * has no `to_email`, `subject` or `html` field: the whole point of surfacing
 * delivery health is that it can be done without reading anyone's mail.
 */
export interface EmailDeliveryRow {
  status: string;
  template: string;
  attempts: number | null;
  created_at: string;
  next_attempt_at?: string | null;
}

export interface EmailHealth {
  /** Count per status: sent / pending / failed_transient / failed_permanent / … */
  byStatus: Record<string, number>;
  /** Retryable work waiting for the outbox worker. */
  backlog: number;
  /** Given up on after MAX_ATTEMPTS — needs a human, not another retry. */
  deadLetter: number;
  /** Dead letters per template, so a single broken template is obvious. */
  deadLetterByTemplate: Record<string, number>;
  /** Age of the oldest unsent retryable row, in hours. Null when none. */
  oldestBacklogHours: number | null;
  /** Sent ÷ (sent + permanently failed). Null when nothing has been attempted. */
  deliveryRate: number | null;
}

const RETRYABLE_STATUSES = new Set(["pending", "failed_transient", "not_configured"]);

/**
 * Delivery health from the ledger alone. No content, no recipients, no provider
 * payloads — categories, counts and ages only.
 */
export function emailHealth(
  rows: EmailDeliveryRow[],
  now: Date = new Date()
): EmailHealth {
  const byStatus: Record<string, number> = {};
  const deadLetterByTemplate: Record<string, number> = {};
  let backlog = 0;
  let deadLetter = 0;
  let sent = 0;
  let oldestBacklogMs: number | null = null;

  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    if (r.status === "sent") sent += 1;
    if (r.status === "failed_permanent") {
      deadLetter += 1;
      deadLetterByTemplate[r.template] = (deadLetterByTemplate[r.template] ?? 0) + 1;
    }
    if (RETRYABLE_STATUSES.has(r.status)) {
      backlog += 1;
      const age = now.getTime() - ts(r.created_at);
      if (Number.isFinite(age) && (oldestBacklogMs === null || age > oldestBacklogMs)) {
        oldestBacklogMs = age;
      }
    }
  }

  const attempted = sent + deadLetter;
  return {
    byStatus,
    backlog,
    deadLetter,
    deadLetterByTemplate,
    oldestBacklogHours:
      oldestBacklogMs === null ? null : round(oldestBacklogMs / 3_600_000),
    // Not suppressed: these are message counts, not people, and an operator
    // needs to see a broken provider on the first failure, not the fifth.
    deliveryRate: attempted === 0 ? null : round(sent / attempted),
  };
}

// --- MW-V10-02: trial-length experiment comparison ---------------------------

/** A subscriptions row with the pinned cohort fields. */
export interface TrialVariantSubRow {
  user_id: string;
  status: string | null;
  trial_variant?: string | null;
  trial_days?: number | null;
  trial_used_at?: string | null;
}

export interface TrialVariantStats {
  /** Allowlisted variant code (e.g. "control", "week_beta"). */
  variant: string;
  /** Trial length the cohort was granted, or null when rows disagree. */
  trialDays: number | null;
  /** Users assigned to this arm who actually started a trial. */
  cohortSize: number;
  /**
   * Every figure below is null when the cohort is smaller than MIN_COHORT —
   * that is the "no data yet" state an owner must be able to distinguish from
   * a real zero. `suppressed` says which of the two it is.
   */
  suppressed: boolean;
  /** Came back and checked in on a later day than their trial start. */
  returnedAfterDay1: number | null;
  /** Used the differentiating remaining-day repair at least once. */
  repaired: number | null;
  /** Reached a real week closeout (not the labelled preview). */
  weeklyReflection: number | null;
  /** Converted to paid, i.e. the trial was charged. */
  converted: number | null;
  canceled: number | null;
  /** converted / cohortSize, rounded. */
  conversionRate: number | null;
  /** AI spend attributable to the cohort in the window, USD. */
  costUsd: number | null;
}

/**
 * Compare the trial-length arms on the outcomes the experiment exists to
 * decide: did a longer trial let people reach the continuity loop (return,
 * repair, week closeout) and did that convert — at what AI cost.
 *
 * Deliberate properties:
 * - Cohort membership comes from the PINNED variant on the subscriptions row,
 *   not from a re-derived assignment, so a flag change cannot retroactively
 *   move users between arms and rewrite history.
 * - Only users who actually started a trial count, so an abandoned checkout
 *   never depresses one arm's conversion.
 * - Every derived figure is suppressed below MIN_COHORT and the arm is flagged,
 *   so a two-person cohort reads as "not enough data" rather than "0%".
 */
export function trialExperimentComparison(
  subs: TrialVariantSubRow[],
  events: EventRow[],
  costs: UsageRow[] = []
): TrialVariantStats[] {
  const byVariant = new Map<string, TrialVariantSubRow[]>();
  for (const s of subs) {
    // No pinned variant = never assigned (pre-experiment rows). No trial start
    // = never entered the experiment's population.
    if (!s.trial_variant || !s.trial_used_at) continue;
    const list = byVariant.get(s.trial_variant) ?? [];
    list.push(s);
    byVariant.set(s.trial_variant, list);
  }

  // Index events per user once, rather than per arm per metric.
  const perUser = new Map<string, EventRow[]>();
  for (const e of events) {
    if (!e.user_id) continue;
    const list = perUser.get(e.user_id) ?? [];
    list.push(e);
    perUser.set(e.user_id, list);
  }

  const costPerUser = new Map<string, number>();
  for (const c of costs) {
    if (!c.user_id || c.status === "released") continue;
    costPerUser.set(c.user_id, (costPerUser.get(c.user_id) ?? 0) + rowCost(c));
  }

  const out: TrialVariantStats[] = [];
  for (const [variant, rows] of byVariant) {
    const cohortSize = rows.length;
    const days = new Set(
      rows.map((r) => r.trial_days).filter((d): d is number => typeof d === "number")
    );

    let returned = 0;
    let repaired = 0;
    let reflected = 0;
    let converted = 0;
    let canceled = 0;
    let cost = 0;

    for (const row of rows) {
      const evts = perUser.get(row.user_id) ?? [];
      const has = (event: string) => evts.some((e) => e.event === event);
      const trialStart = row.trial_used_at ? ts(row.trial_used_at) : NaN;

      if (
        Number.isFinite(trialStart) &&
        evts.some(
          (e) =>
            e.event === "checkin_completed" &&
            ts(e.created_at) >= trialStart + 86_400_000
        )
      ) {
        returned++;
      }
      if (has("plan_repair_completed")) repaired++;
      if (has("weekly_reflection_completed")) reflected++;
      // Either signal is a charge: the trial→active transition, or a renewal
      // for a user whose conversion event fell outside the window.
      if (has("trial_converted") || has("subscription_renewed")) converted++;
      if (has("trial_canceled")) canceled++;
      cost += costPerUser.get(row.user_id) ?? 0;
    }

    const small = cohortSize < MIN_COHORT;
    out.push({
      variant,
      trialDays: days.size === 1 ? [...days][0] : null,
      cohortSize,
      suppressed: small,
      returnedAfterDay1: suppress(returned, cohortSize),
      repaired: suppress(repaired, cohortSize),
      weeklyReflection: suppress(reflected, cohortSize),
      converted: suppress(converted, cohortSize),
      canceled: suppress(canceled, cohortSize),
      conversionRate: suppress(round(converted / (cohortSize || 1)), cohortSize),
      costUsd: suppress(round2(cost), cohortSize),
    });
  }

  return out.sort((a, b) => a.variant.localeCompare(b.variant));
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
