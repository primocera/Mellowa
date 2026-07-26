import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";
import {
  WeeklyPlanView,
  WeeklyPlanEmpty,
} from "@/components/dailyflow/weekly-plan-view";
import { WeeklyReflection } from "@/components/dailyflow/weekly-reflection";
import { WeeklyRecapCard } from "@/components/dailyflow/weekly-recap";
import { WeekPreviewCard } from "@/components/dailyflow/week-preview-card";
import { summarizeWeek } from "@/lib/retention/recap";
import { getUserSubscriptionStatus } from "@/lib/stripe/subscription";
import type { WeeklyPlan } from "@/types/dailyflow";

export const metadata: Metadata = { title: "Week at a glance — Mellowa" };

function sevenDaysAgoIso(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * MW-V9-07: Week is one coherent loop, top to bottom:
 *   1. This week — the factual recorded summary (no scores, no interpretation).
 *   2. Carry forward — the bounded reflection with an exact-effect preview.
 *   3. Next week — the plan the user creates for themselves.
 * Nothing is generated automatically; sparse weeks show no fabricated insight.
 */
export default async function WeeklyPlanPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const weekAgoIso = sevenDaysAgoIso();
  const [{ data: plan }, { data: weekPlans }, { data: weekFeedback }] =
    await Promise.all([
      supabase
        .from("weekly_plans")
        .select("*")
        .eq("user_id", user.id)
        .order("week_start", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
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
  // MW-V10-02: a trial shorter than a week ends before a real closeout exists.
  // Show a clearly labelled example of what this page becomes — never
  // fabricated history — so the carry-forward value is understandable inside
  // the trial. Suppressed as soon as the user has a recorded week of their own.
  const sub = await getUserSubscriptionStatus(user.id);
  const shortTrialDays =
    sub.status === "trialing" && sub.trialLengthDays && sub.trialLengthDays < 7
      ? sub.trialLengthDays
      : null;
  // Transparent no-data handling: nothing recorded means no summary card — the
  // carry-forward section already routes sparse weeks to preferences.
  const hasRecordedWeek = recap.plansCreated > 0 || recap.themes.length > 0;

  return (
    <div className="space-y-6">
      {hasRecordedWeek && (
        <section aria-labelledby="this-week-heading" className="space-y-2">
          <h2
            id="this-week-heading"
            className="px-1 text-xs font-medium uppercase tracking-wide text-[#9CA3AF]"
          >
            This week
          </h2>
          <WeeklyRecapCard recap={recap} />
        </section>
      )}

      {!hasRecordedWeek && shortTrialDays !== null && (
        <WeekPreviewCard trialDays={shortTrialDays} />
      )}

      <section aria-labelledby="carry-forward-heading" className="space-y-2">
        <h2
          id="carry-forward-heading"
          className="px-1 text-xs font-medium uppercase tracking-wide text-[#9CA3AF]"
        >
          Carry forward
        </h2>
        <WeeklyReflection />
      </section>

      <section aria-labelledby="next-week-heading" className="space-y-2">
        <h2
          id="next-week-heading"
          className="px-1 text-xs font-medium uppercase tracking-wide text-[#9CA3AF]"
        >
          Next week
        </h2>
        {plan ? <WeeklyPlanView plan={plan as WeeklyPlan} /> : <WeeklyPlanEmpty />}
      </section>
    </div>
  );
}
