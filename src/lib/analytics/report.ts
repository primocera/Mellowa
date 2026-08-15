import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  funnelConversion,
  conversionRate,
  retention,
  churnCounts,
  unitEconomics,
  generationHealth,
  reconcile,
  detectAnomalies,
  usageScorecard,
  trialExperimentComparison,
  emailHealth,
  costPerOutcome,
  dataFreshness,
  type DataFreshness,
  type EmailDeliveryRow,
  type EventRow,
  type SubRow,
  type CostRow,
  type UsageRow,
} from "@/lib/analytics/metrics";
import { loopDecisions, expansionVerdict } from "@/lib/analytics/loop-decisions";
import { buildCohortScorecard, localDate, type CohortScorecard, type CohortEventRow, type CohortSubRow } from "@/lib/analytics/cohort";
import { readExclusionRegistry, readCanonicalActivation, readCheckinDays } from "@/lib/analytics/facts";
import { supportBurden, type SupportTicketRow } from "@/lib/support/metrics";
import { readBetaCapacity, type BetaCapacity } from "@/lib/beta/capacity";
import { experimentConflicts, runningExperiments } from "@/lib/beta/experiments";
import {
  firstSessionScorecard,
  type FirstSessionScorecard,
  type SessionEvent,
} from "@/lib/today/first-session";

/**
 * Server-side metrics report (Launch v6, Prompt 10). Fetches the rows once and
 * runs the pure metrics transforms, so the admin API and dashboard show the
 * exact same, reproducible numbers. Aggregates only — never user content.
 */

export interface MetricsReport {
  generatedAt: string;
  /**
   * MW-V12-08: how recent the underlying data is. `generatedAt` is always now;
   * this reveals a pipeline that has gone quiet, so no beta decision is made on
   * stale numbers that still look fresh.
   */
  dataFreshness: DataFreshness;
  windowDays: number;
  release: string | null;
  funnels: Record<string, ReturnType<typeof funnelConversion>>;
  sampleToTrial: ReturnType<typeof conversionRate>;
  trialToPaid: ReturnType<typeof conversionRate>;
  retention: { d1: number | null; d7: number | null; d30: number | null };
  churn: ReturnType<typeof churnCounts>;
  economics: ReturnType<typeof unitEconomics>;
  usage: ReturnType<typeof usageScorecard>;
  generation: ReturnType<typeof generationHealth>;
  reconciliation: ReturnType<typeof reconcile>[];
  anomalies: ReturnType<typeof detectAnomalies>;
  /**
   * MW-V10-02: trial-length arms side by side. Empty while no cohort has been
   * assigned; small arms come back suppressed rather than as misleading zeros.
   */
  trialExperiment: ReturnType<typeof trialExperimentComparison>;
  /**
   * MW-V10-05: delivery backlog and dead letters. Categories and counts only —
   * an operator can see that mail is broken without reading anyone's mail.
   */
  email: ReturnType<typeof emailHealth>;
  /** MW-V10-06: the value loop with a decision per step, and the one question. */
  loop: ReturnType<typeof loopDecisions>;
  expansion: ReturnType<typeof expansionVerdict>;
  /** MW-V10-06: cost per outcome. `null` means unknown, never zero. */
  costPerOutcome: ReturnType<typeof costPerOutcome>;
  /** MW-V10-06: beta intake state; null when it cannot be read. */
  beta: BetaCapacity | null;
  /** MW-V10-06: overlapping experiments make neither result attributable. */
  experimentConflicts: ReturnType<typeof experimentConflicts>;
  /**
   * MW-V17-07: the recurring-value scorecard from ONE canonical cohort — exact
   * distinct-local-calendar-day D2/D3, repair apply/undo/repeat, Week
   * opened/closeout/carry-forward, conversion/renewal/refund/dispute, and support
   * burden (UNAVAILABLE). Every row carries maturity/pending/suppression.
   *
   * MW-V18-05: activation and D-N return are now sourced from durable
   * full-history facts (not a 30-day slice), staff/test/demo ids come from the
   * server-owned registry, and the scorecard carries its definition version,
   * source watermark and conservative mature-through date.
   */
  cohort: CohortScorecard;
  /** MW-V18-05: whether the durable exclusion registry / activation facts read. */
  cohortDataQuality: { exclusionsAvailable: boolean; activationFactsAvailable: boolean };
  /**
   * MW-08: the operational first-session funnel from live events —
   * onboarding → check-in → plan → meaningful action → first_value, with
   * reached/pending/missed inside the 30-minute window. Distinguishes pending
   * (window open) from missed (window closed); small cohorts are suppressed.
   */
  firstSession: FirstSessionScorecard;
}

export async function buildMetricsReport(
  windowDays = 30,
  release: string | null = null
): Promise<MetricsReport> {
  const admin = createAdminClient();
  const now = Date.now();
  const day = 24 * 3600 * 1000;
  const since = new Date(now - windowDays * day).toISOString();
  const priorSince = new Date(now - 2 * windowDays * day).toISOString();

  const [
    { data: eventRows },
    { data: priorEventRows },
    { data: subRows },
    { data: costRows },
    { data: emailRows },
  ] =
    await Promise.all([
      admin.from("app_events").select("event, user_id, anon_id, created_at").gte("created_at", since),
      admin
        .from("app_events")
        .select("event, user_id, anon_id, created_at")
        .gte("created_at", priorSince)
        .lt("created_at", since),
      admin
        .from("subscriptions")
        .select(
          "user_id, status, plan_name, trial_used_at, cancel_at_period_end, current_period_end, created_at, trial_variant, trial_days, currency"
        ),
      admin
        .from("ai_usage_events")
        .select("user_id, status, estimated_cost_usd, actual_cost_usd, created_at")
        .gte("created_at", since),
      // Never select to_email / subject / html — delivery health must be
      // observable without exposing message content or recipients.
      admin
        .from("email_deliveries")
        .select("status, template, attempts, created_at, next_attempt_at")
        .gte("created_at", since),
    ]);

  const events = (eventRows ?? []) as EventRow[];
  const prior = (priorEventRows ?? []) as EventRow[];
  const subs = (subRows ?? []) as SubRow[];
  const costs = (costRows ?? []) as CostRow[];
  const usageRows = (costRows ?? []) as unknown as UsageRow[];

  // Server-authoritative counts for reconciliation.
  const [{ count: plansInWindow }, { count: safetyBlocked }, { count: paidTrials }] = await Promise.all([
    admin.from("daily_plans").select("id", { count: "exact", head: true }).gte("created_at", since),
    admin.from("safety_events").select("id", { count: "exact", head: true }).gte("created_at", since),
    admin.from("subscriptions").select("user_id", { count: "exact", head: true }).not("trial_used_at", "is", null),
  ]);

  const funnels = {
    acquisition: funnelConversion(events, "acquisition"),
    activation: funnelConversion(events, "activation"),
    monetization: funnelConversion(events, "monetization"),
    billing_health: funnelConversion(events, "billing_health"),
    // MW-V9-11: the full beta value loop, signup → renewal. Same DISTINCT-subject
    // math and MIN_COHORT suppression as the other funnels.
    value_loop: funnelConversion(events, "value_loop"),
  };

  const countEvent = (rows: EventRow[], e: string) =>
    new Set(rows.filter((r) => r.event === e).map((r) => r.user_id ?? r.anon_id).filter(Boolean)).size;

  const currentCounts = {
    signup_completed: countEvent(events, "signup_completed"),
    sample_plan_generated: countEvent(events, "sample_plan_generated"),
    trial_started: countEvent(events, "trial_started"),
    checkout_completed: countEvent(events, "checkout_completed"),
  };
  const baselineCounts = {
    signup_completed: countEvent(prior, "signup_completed"),
    sample_plan_generated: countEvent(prior, "sample_plan_generated"),
    trial_started: countEvent(prior, "trial_started"),
    checkout_completed: countEvent(prior, "checkout_completed"),
  };

  // MW-V10-06: decisions are derived from the SAME funnel steps the dashboard
  // renders, so the numbers and the recommended action can never disagree.
  const loop = loopDecisions(funnels.value_loop);
  const beta = await readBetaCapacity(admin);

  // MW-V17-07: per-user timezone for DST-correct local-calendar-day cohorting.
  const { data: tzRows } = await admin
    .from("wellbeing_profiles")
    .select("user_id, timezone");
  const timezoneByUser: Record<string, string> = {};
  for (const r of (tzRows ?? []) as { user_id: string; timezone: string | null }[]) {
    if (r.user_id && r.timezone) timezoneByUser[r.user_id] = r.timezone;
  }
  // M05: cohort activation/return now come from DURABLE, full-history facts
  // (daily_checkins + the analytics_activation_facts view), not the 30-day
  // event slice; exclusions come from the SERVER-OWNED registry, not the caller.
  const [exclusion, activation, checkinDays] = await Promise.all([
    readExclusionRegistry(admin),
    readCanonicalActivation(admin),
    readCheckinDays(admin, localDate, timezoneByUser),
  ]);

  // Source watermark: the freshest fact/event the report is built from, so a
  // quiet pipeline reads as stale rather than as a real zero.
  let watermarkMs = 0;
  for (const e of events) {
    const t = Date.parse(e.created_at);
    if (Number.isFinite(t) && t > watermarkMs) watermarkMs = t;
  }
  for (const iso of Object.values(activation.activatedAtByUser)) {
    const t = Date.parse(iso);
    if (Number.isFinite(t) && t > watermarkMs) watermarkMs = t;
  }
  const sourceWatermark = watermarkMs > 0 ? new Date(watermarkMs).toISOString() : undefined;

  // MW-V18-08: privacy-safe support burden over the same cohort. A ledger read
  // error is UNAVAILABLE (never a zero). Paid = active subscription that has used
  // a trial (a real payer). Activated denominator = the canonical activation fact.
  const [ticketsRes, paidRes] = await Promise.all([
    admin
      .from("support_tickets")
      .select("dedupe_key, account_user_id, category, status, reopened_count, first_response_at, resolved_at, created_at"),
    admin
      .from("subscriptions")
      .select("user_id", { count: "exact", head: true })
      .eq("status", "active")
      .not("trial_used_at", "is", null),
  ]);
  const burden = supportBurden({
    tickets: (ticketsRes.data ?? []) as SupportTicketRow[],
    activatedUsers: Object.keys(activation.activatedAtByUser).length,
    paidUsers: paidRes.count ?? 0,
    excludedUserIds: exclusion.ids,
    available: !ticketsRes.error,
  });

  // Only feed the durable facts through when both were readable; otherwise fall
  // back to the event-window derivation rather than reporting a half-durable
  // cohort. `factsAvailable` is surfaced so a degraded read is visible.
  const factsAvailable = activation.available && checkinDays.available;
  const cohort = buildCohortScorecard({
    events: events as CohortEventRow[],
    subs: subs as unknown as CohortSubRow[],
    timezoneByUser,
    excludedUserIds: exclusion.ids,
    canonicalActivation: factsAvailable
      ? {
          activatedAtByUser: activation.activatedAtByUser,
          checkinLocalDaysByUser: checkinDays.daysByUser,
        }
      : undefined,
    supportBurden: burden,
    sourceWatermark,
    now: new Date(now),
  });
  const cohortDataQuality = {
    exclusionsAvailable: exclusion.available,
    activationFactsAvailable: factsAvailable,
  };

  // MW-08: the first-session value funnel from LIVE events (not the test-only
  // helper). Group server events per user, drop staff/test/demo, and compute the
  // reached/pending/missed scorecard inside the 30-minute window. first_value is
  // a durable action only — a view or a served fallback never inflates it.
  const excludedIds = new Set(exclusion.ids);
  const sessionsByUser = new Map<string, SessionEvent[]>();
  for (const e of events) {
    const uid = e.user_id;
    if (!uid || excludedIds.has(uid)) continue;
    const list = sessionsByUser.get(uid) ?? [];
    list.push({ event: e.event, created_at: e.created_at });
    sessionsByUser.set(uid, list);
  }
  const firstSession = firstSessionScorecard([...sessionsByUser.values()], new Date(now));

  return {
    generatedAt: new Date().toISOString(),
    // Freshness comes from the events themselves, not the clock — an empty or
    // quiet window reports stale rather than looking current.
    dataFreshness: dataFreshness(eventRows, new Date(now)),
    windowDays,
    release,
    funnels,
    sampleToTrial: conversionRate(events, "sample_plan_generated", "trial_started"),
    trialToPaid: conversionRate(events, "trial_started", "trial_converted"),
    retention: {
      d1: retention(events, "sample_plan_generated", ["checkin_completed", "plan_generated"], 1),
      d7: retention(events, "sample_plan_generated", ["checkin_completed", "plan_generated"], 7),
      d30: retention(events, "sample_plan_generated", ["checkin_completed", "plan_generated"], 30),
    },
    churn: churnCounts(events),
    economics: unitEconomics(subs, costs),
    // Ceiling denials are not persisted (a denied claim writes no ledger row),
    // so the count is 0 here; p50/p90 + high-use already flag unsustainable use.
    // Denial logging is a documented follow-up in docs/runbooks/monitoring-alerts.md.
    usage: usageScorecard(usageRows, 0),
    generation: generationHealth(events, safetyBlocked ?? 0),
    reconciliation: [
      reconcile(countEvent(events, "plan_generated"), plansInWindow ?? 0, "plans_generated_vs_events", 2),
      reconcile(currentCounts.trial_started, paidTrials ?? 0, "trials_started_vs_subscriptions", 2),
    ],
    anomalies: detectAnomalies(currentCounts, baselineCounts),
    // Cohort membership is read from the pinned variant, so this comparison is
    // unaffected by the flag being turned off mid-experiment.
    email: emailHealth((emailRows ?? []) as EmailDeliveryRow[]),
    loop: loop,
    expansion: expansionVerdict(loop, windowDays),
    costPerOutcome: costPerOutcome(usageRows, {
      samplesGenerated: currentCounts.sample_plan_generated,
      trialsStarted: currentCounts.trial_started,
      retainedPayers: countEvent(events, "subscription_renewed"),
    }),
    beta,
    experimentConflicts: experimentConflicts(runningExperiments()),
    trialExperiment: trialExperimentComparison(
      subs,
      events,
      usageRows
    ),
    cohort,
    cohortDataQuality,
    firstSession,
  };
}

/** Flatten the report into CSV rows for export. */
export function reportToCsv(report: MetricsReport): string {
  const lines: string[] = ["metric,dimension,value"];
  const push = (m: string, d: string, v: unknown) => lines.push(`${m},${d},${csv(v)}`);
  // MW-V12-08: freshness first — a reader must see the data is stale before any
  // rate below persuades them of anything.
  push("data_freshness", "last_event_age_hours", report.dataFreshness.ageHours);
  push("data_freshness", "stale", report.dataFreshness.stale ? "yes" : "no");
  for (const [name, steps] of Object.entries(report.funnels)) {
    for (const s of steps) push(`funnel_${name}`, s.event, s.reached);
  }
  push("sample_to_trial", "rate", report.sampleToTrial.rate);
  push("trial_to_paid", "rate", report.trialToPaid.rate);
  push("retention", "d1", report.retention.d1);
  push("retention", "d7", report.retention.d7);
  push("retention", "d30", report.retention.d30);
  push("churn", "voluntary", report.churn.voluntary);
  push("churn", "involuntary", report.churn.involuntary);
  push("economics", "active_payers", report.economics.activePayers);
  push("economics", "unknown_currency_payers", report.economics.unknownCurrencyPayers);
  // Per-currency MRR is native and never summed into one figure.
  for (const c of report.economics.mrrByCurrency) {
    push("economics", `mrr_${c.currency}`, c.mrr);
  }
  push("economics", "ai_cost_usd", report.economics.aiCostUsd);
  // A USD rollup only exists when an explicit FX rate was supplied.
  if (report.economics.normalizedUsd) {
    push("economics", "mrr_usd_estimate", report.economics.normalizedUsd.mrrUsd);
    push(
      "economics",
      "contribution_per_payer_usd_estimate",
      report.economics.normalizedUsd.contributionPerPayerUsd
    );
  }
  push("usage", "generations_p50", report.usage.generationsP50);
  push("usage", "generations_p90", report.usage.generationsP90);
  push("usage", "high_use_users", report.usage.highUseUsers);
  push("usage", "ceiling_denials", report.usage.ceilingDenials);
  push("usage", "total_cost_usd", report.usage.totalCostUsd);
  push("generation", "fallback_rate", report.generation.fallbackRate);
  for (const r of report.reconciliation) push("reconcile", r.metric, r.reconciled ? "ok" : "MISMATCH");
  push("email", "backlog", report.email.backlog);
  push("email", "dead_letter", report.email.deadLetter);
  push("email", "oldest_backlog_hours", report.email.oldestBacklogHours);
  push("email", "delivery_rate", report.email.deliveryRate);
  push("expansion", "can_expand", report.expansion.canExpand ? "yes" : "no");
  push("cost_per", "sample_usd", report.costPerOutcome.perSampleUsd);
  push("cost_per", "activated_trial_usd", report.costPerOutcome.perActivatedTrialUsd);
  push("cost_per", "retained_payer_usd", report.costPerOutcome.perRetainedPayerUsd);
  push("cost_per", "high_use_user_usd", report.costPerOutcome.perHighUseUserUsd);
  for (const d of report.loop) {
    // numerator/denominator/state per step, so the CSV carries the decision
    // context and not just a bare count.
    push(`loop_${d.event}`, "numerator", d.numerator);
    push(`loop_${d.event}`, "denominator", d.denominator);
    push(`loop_${d.event}`, "state", d.state);
  }
  for (const [template, n] of Object.entries(report.email.deadLetterByTemplate)) {
    push("email_dead_letter", template, n);
  }
  // MW-V17-07: the recurring-value cohort. Each row exports numerator,
  // denominator, pending, state and suppression, so a pending/UNAVAILABLE row can
  // never be mistaken for a measured zero.
  push("cohort", "activated_users", report.cohort.activatedUsers);
  // M05: self-describing provenance, so a reader knows the definition version,
  // how fresh the data is, how far maturity is guaranteed, and whether the
  // durable fact/exclusion sources were actually readable.
  push("cohort", "definition_version", report.cohort.definitionVersion);
  push("cohort", "activation_source", report.cohort.activationSource);
  push("cohort", "source_watermark", report.cohort.sourceWatermark);
  push("cohort", "mature_through_utc", report.cohort.matureThroughUtc);
  push("cohort", "exclusions_available", report.cohortDataQuality.exclusionsAvailable ? "yes" : "no");
  push("cohort", "activation_facts_available", report.cohortDataQuality.activationFactsAvailable ? "yes" : "no");
  for (const r of report.cohort.rows) {
    push(`cohort_${r.id}`, "numerator", r.numerator);
    push(`cohort_${r.id}`, "denominator", r.denominator);
    push(`cohort_${r.id}`, "pending", r.pending);
    push(`cohort_${r.id}`, "rate", r.rate);
    push(`cohort_${r.id}`, "state", r.state);
    push(`cohort_${r.id}`, "suppressed", r.suppressed ? "yes" : "no");
  }
  // A suppressed arm exports empty cells, never a zero that reads as a result.
  for (const v of report.trialExperiment) {
    push(`trial_experiment_${v.variant}`, "trial_days", v.trialDays);
    push(`trial_experiment_${v.variant}`, "cohort_size", v.cohortSize);
    push(`trial_experiment_${v.variant}`, "returned_after_day1", v.returnedAfterDay1);
    push(`trial_experiment_${v.variant}`, "repaired", v.repaired);
    push(`trial_experiment_${v.variant}`, "weekly_reflection", v.weeklyReflection);
    push(`trial_experiment_${v.variant}`, "converted", v.converted);
    push(`trial_experiment_${v.variant}`, "canceled", v.canceled);
    push(`trial_experiment_${v.variant}`, "conversion_rate", v.conversionRate);
    push(`trial_experiment_${v.variant}`, "cost_usd", v.costUsd);
    push(`trial_experiment_${v.variant}`, "suppressed", v.suppressed ? "yes" : "no");
  }
  // MW-08: first-session funnel. cohort_size is the denominator; suppressed marks
  // a small cell; reached/pending/missed are kept distinct so pending never reads
  // as failure.
  push("first_session", "cohort_size", report.firstSession.cohortSize);
  push("first_session", "suppressed", report.firstSession.suppressed ? "yes" : "no");
  push("first_session", "window_min", report.firstSession.windowMin);
  if (!report.firstSession.suppressed) {
    for (const m of report.firstSession.milestones) {
      push("first_session_milestone", m.milestone, m.reached);
    }
    push("first_session_value", "reached", report.firstSession.firstValue.reached);
    push("first_session_value", "pending", report.firstSession.firstValue.pending);
    push("first_session_value", "missed", report.firstSession.firstValue.missed);
  }
  return lines.join("\n");
}

function csv(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}
