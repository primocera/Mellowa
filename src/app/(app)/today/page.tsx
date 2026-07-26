import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";
import { TodayPlanV2 } from "@/components/dailyflow/today-plan-v2";
import { LowEnergyDayCard } from "@/components/dailyflow/low-energy-day-card";
import { isValidTimeZone, localDateFor } from "@/lib/dates/local-day";
import { TimezoneRepair } from "@/components/dailyflow/timezone-repair";
import { planProvenanceSummary } from "@/lib/plan/provenance";

export const metadata: Metadata = { title: "Today — Mellowa" };

function ninetyDaysAgoIso(): string {
  return new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * MW-V9-07: Today stays focused on the one next action. The weekly recorded
 * summary and carry-forward live on Week — Today only offers a quiet link so
 * the recap never competes with Now.
 */
function WeekLink() {
  return (
    <Link
      href="/weekly-plan"
      className="block px-2 text-center text-xs text-[#9CA3AF] underline underline-offset-2 hover:text-[#6B7280]"
    >
      Review your week
    </Link>
  );
}

/**
 * MW-V10-04: how this plan was made, in plain language. A curated backup day is
 * stated as one — unlabelled, it would read as a plan built for this person.
 * Version ids only; the system prompt is never exposed.
 */
function PlanProvenance(props: {
  promptVersion?: string | null;
  modelVersion?: string | null;
  isFallback?: boolean | null;
}) {
  const summary = planProvenanceSummary(props);

  // A backup day is stated up front, not folded away — it is the one case where
  // the user needs to know before they read the plan.
  if (summary.fallback) {
    return (
      <p className="rounded-2xl bg-[#FEF3C7] px-4 py-3 text-xs text-[#1F2937]">
        {summary.headline}
      </p>
    );
  }

  return (
    <details className="px-2 text-xs text-[#9CA3AF]">
      <summary className="cursor-pointer list-none underline underline-offset-2">
        How this plan was made
      </summary>
      <p className="mt-1.5">
        {summary.headline}
        {summary.detail && (
          <span className="ml-1">({summary.detail})</span>
        )}
      </p>
    </details>
  );
}

export default async function TodayPage() {
  const user = await requireUser();
  const supabase = await createClient();

  // Prompt 9: Today means the user's LOCAL date, computed server-side from
  // their stored IANA timezone. Only profiles without a valid timezone fall
  // back to the old rolling-day window.
  const { data: profileRow } = await supabase
    .from("wellbeing_profiles")
    .select("show_macros, timezone")
    .eq("user_id", user.id)
    .maybeSingle();

  let planQuery = supabase
    .from("daily_plans")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1);
  if (isValidTimeZone(profileRow?.timezone)) {
    planQuery = planQuery.eq("plan_date", localDateFor(profileRow!.timezone!));
  } else {
    const now = new Date();
    now.setDate(now.getDate() - 1);
    planQuery = planQuery.gte("plan_date", now.toISOString().slice(0, 10));
  }
  const planRes = await planQuery.maybeSingle();
  const profileRes = { data: profileRow };
  const timezoneNeedsRepair =
    !!profileRow && !isValidTimeZone(profileRow.timezone);

  const plan = planRes.data;

  // Opt-in only (Prompt 7); a recent eating-disorder safety signal overrides
  // the preference so estimates never show to someone at risk.
  let showMacros = profileRes.data?.show_macros ?? false;
  if (showMacros) {
    const { count: edSignals } = await supabase
      .from("safety_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .ilike("risk_type", "%eating_disorder%")
      .gte("created_at", ninetyDaysAgoIso());
    if ((edSignals ?? 0) > 0) showMacros = false;
  }

  // No plan, or an older plan from before the v2 format → fresh check-in.
  if (!plan || !plan.meal_cards) {
    return (
      <div className="space-y-4">
        {timezoneNeedsRepair && <TimezoneRepair />}
        <p className="text-xs font-medium uppercase tracking-wide text-[#9CA3AF]">
        Today · no plan yet
      </p>
      <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-[#1F2937]">
          What kind of day is this?
        </h1>
        <p className="mt-2 text-sm text-[#6B7280]">
          A one-minute check-in shapes meals, a water cue, optional movement and
          one pause around the time and energy you actually have.
        </p>
        <Link
          href="/check-in"
          className="mt-6 inline-block rounded-xl bg-[#7C9A92] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#6D8C7D]"
        >
          Check in for today
        </Link>
        </div>
        <LowEnergyDayCard />
        <WeekLink />
      </div>
    );
  }

  // Persisted "mark as done" items for this plan.
  const { data: completions } = await supabase
    .from("plan_completions")
    .select("item_key")
    .eq("daily_plan_id", plan.id);
  const completedKeys = (completions ?? []).map((c) => c.item_key);

  return (
    <div className="space-y-4">
      {timezoneNeedsRepair && <TimezoneRepair />}
      <p className="text-xs font-medium uppercase tracking-wide text-[#9CA3AF]">
        Today · plan ready
      </p>
      <LowEnergyDayCard />
      <TodayPlanV2
        plan={plan}
        showMacros={showMacros}
        completedKeys={completedKeys}
      />
      <PlanProvenance
        promptVersion={plan.prompt_version}
        modelVersion={plan.model_version}
        isFallback={plan.is_fallback}
      />
      <WeekLink />
    </div>
  );
}
