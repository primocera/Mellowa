import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";
import { TodayPlanV2 } from "@/components/dailyflow/today-plan-v2";
import { LowEnergyDayCard } from "@/components/dailyflow/low-energy-day-card";
import { isValidTimeZone, localDateFor } from "@/lib/dates/local-day";
import { TimezoneRepair } from "@/components/dailyflow/timezone-repair";
import { WeeklyRecapCard } from "@/components/dailyflow/weekly-recap";
import { summarizeWeek } from "@/lib/retention/recap";

export const metadata: Metadata = { title: "Today — Mellowa" };

function ninetyDaysAgoIso(): string {
  return new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
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

  // Neutral weekly recap (Prompt 22): plans created + feedback themes over the
  // last 7 days. No adherence, streaks or mood — see summarizeWeek.
  const weekAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: weekPlans }, { data: weekFeedback }] = await Promise.all([
    supabase
      .from("daily_plans")
      .select("created_at")
      .eq("user_id", user.id)
      .gte("created_at", weekAgoIso),
    supabase
      .from("plan_feedback")
      .select("verdict, created_at")
      .eq("user_id", user.id)
      .gte("created_at", weekAgoIso),
  ]);
  const recap = summarizeWeek(weekPlans ?? [], weekFeedback ?? []);
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
        <WeeklyRecapCard recap={recap} />
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
      <WeeklyRecapCard recap={recap} />
    </div>
  );
}
