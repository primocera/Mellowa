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
  type EventRow,
  type SubRow,
  type CostRow,
  type UsageRow,
} from "@/lib/analytics/metrics";

/**
 * Server-side metrics report (Launch v6, Prompt 10). Fetches the rows once and
 * runs the pure metrics transforms, so the admin API and dashboard show the
 * exact same, reproducible numbers. Aggregates only — never user content.
 */

export interface MetricsReport {
  generatedAt: string;
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

  const [{ data: eventRows }, { data: priorEventRows }, { data: subRows }, { data: costRows }] =
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
          "user_id, status, plan_name, trial_used_at, cancel_at_period_end, created_at, trial_variant, trial_days"
        ),
      admin
        .from("ai_usage_events")
        .select("user_id, status, estimated_cost_usd, actual_cost_usd, created_at")
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

  return {
    generatedAt: new Date().toISOString(),
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
    trialExperiment: trialExperimentComparison(
      subs,
      events,
      usageRows
    ),
  };
}

/** Flatten the report into CSV rows for export. */
export function reportToCsv(report: MetricsReport): string {
  const lines: string[] = ["metric,dimension,value"];
  const push = (m: string, d: string, v: unknown) => lines.push(`${m},${d},${csv(v)}`);
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
  push("economics", "mrr_eur", report.economics.mrrEur);
  push("economics", "contribution_per_user_eur", report.economics.contributionPerUserEur);
  push("usage", "generations_p50", report.usage.generationsP50);
  push("usage", "generations_p90", report.usage.generationsP90);
  push("usage", "high_use_users", report.usage.highUseUsers);
  push("usage", "ceiling_denials", report.usage.ceilingDenials);
  push("usage", "total_cost_usd", report.usage.totalCostUsd);
  push("generation", "fallback_rate", report.generation.fallbackRate);
  for (const r of report.reconciliation) push("reconcile", r.metric, r.reconciled ? "ok" : "MISMATCH");
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
  return lines.join("\n");
}

function csv(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}
