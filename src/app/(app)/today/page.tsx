import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";
import { TodayPlanV2 } from "@/components/dailyflow/today-plan-v2";
import { LowEnergyDayCard } from "@/components/dailyflow/low-energy-day-card";
import { isValidTimeZone, localDateFor } from "@/lib/dates/local-day";
import { TimezoneRepair } from "@/components/dailyflow/timezone-repair";
import { planProvenanceSummary } from "@/lib/plan/provenance";
import { ButtonLink, Callout, EmptyState } from "@/components/ui";

/** Human date for a stored plan_date (YYYY-MM-DD). Never a guessed value. */
function formatPlanDate(planDate: string | null | undefined): string {
  if (!planDate) return "an earlier day";
  const d = new Date(`${planDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "an earlier day";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
}

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

  // Prompt 9: Today means the user's LOCAL date, computed server-side from the
  // stored IANA timezone.
  //
  // MW-V10-07: these two reads are independent, so they run in parallel — the
  // plan query no longer needs the timezone, because it fetches the latest plan
  // and the DATE COMPARISON happens below. That removes a round trip from the
  // most-visited authenticated route.
  const [{ data: profileRow }, planRes] = await Promise.all([
    supabase
      .from("wellbeing_profiles")
      .select("show_macros, timezone")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("daily_plans")
      .select("*")
      .eq("user_id", user.id)
      .order("plan_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // MW-V10-07: the previous rolling-window fallback for an unknown timezone
  // could return YESTERDAY's plan, and the page then labelled it
  // "Today · plan ready". A stale plan presented as today's is worse than no
  // plan: the user follows a day built for different conditions. The plan's own
  // `plan_date` is now always compared, and a mismatch is stated, not hidden.
  const resolvedTimeZone = isValidTimeZone(profileRow?.timezone)
    ? profileRow!.timezone!
    : null;
  const timezoneNeedsRepair = !!profileRow && resolvedTimeZone === null;
  // With no usable timezone we cannot know the user's local date, so we fall
  // back to UTC — and the TimezoneRepair prompt says so rather than pretending.
  const assumedLocalDate = localDateFor(resolvedTimeZone ?? "UTC");
  const profileRes = { data: profileRow };

  const latestPlan = planRes.data;
  // Only a plan whose own date matches the resolved local date is "today's".
  const plan =
    latestPlan && latestPlan.plan_date === assumedLocalDate ? latestPlan : null;
  // A recent-but-not-today plan is still worth offering — labelled with its
  // real date, as history, never as today's plan.
  const stalePlan =
    latestPlan && latestPlan.plan_date !== assumedLocalDate ? latestPlan : null;

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

  // No plan for today, or an older plan from before the v2 format → check-in.
  if (!plan || !plan.meal_cards) {
    return (
      <div className="space-y-4">
        {timezoneNeedsRepair && <TimezoneRepair />}
        <p className="text-xs font-medium uppercase tracking-wide text-[#9CA3AF]">
          Today · no plan yet
        </p>
        {/* MW-V10-07: a plan from another day is named with its date and framed
            as history. Never rendered as "today's plan" — following a day built
            for different conditions is worse than having no plan at all. */}
        {stalePlan && (
          <Callout tone="neutral">
            Your most recent plan is from{" "}
            <strong>{formatPlanDate(stalePlan.plan_date)}</strong>, not today. It
            stays readable, and a new check-in shapes one for today.{" "}
            <Link href="/plan" className="underline underline-offset-2">
              Open that plan
            </Link>
            .
          </Callout>
        )}
        <EmptyState
          title="What kind of day is this?"
          description="A one-minute check-in shapes meals, a water cue, optional movement and one pause around the time and energy you actually have."
          action={
            <ButtonLink href="/check-in">Check in for today</ButtonLink>
          }
        />
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
