import "server-only";
import { startOfMonth, format, differenceInCalendarDays } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import {
  PLAN_LIMITS,
  entitlementFor,
  type Entitlement,
  type PlanTier,
  type PremiumFeature,
} from "./plans";
import { trialDaysFromDates } from "./trial-experiment";

export type SubscriptionStatus =
  | "none"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete";

export interface UserSubscriptionStatus {
  plan: PlanTier;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  /**
   * MW-V10-02: total length of THIS user's trial in days, derived from the
   * Stripe trial window on their row. Null when no trial window is stored —
   * copy then stays length-neutral instead of assuming the control length.
   */
  trialLengthDays: number | null;
  currentPeriodEnd: string | null;
  isPremium: boolean;
  daysLeftInTrial: number | null;
  shouldShowTrialBanner: boolean;
  cancelAtPeriodEnd: boolean;
  planName: string | null;
  /** Canonical access matrix for this status (Prompt 3). */
  entitlement: Entitlement;
}

/**
 * Single source of truth for a user's subscription state.
 * Premium = Stripe status trialing or active.
 */
export async function getUserSubscriptionStatus(
  userId: string
): Promise<UserSubscriptionStatus> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("subscriptions")
    .select(
      "status, trial_start, trial_end, current_period_end, cancel_at_period_end, plan_name, trial_days"
    )
    .eq("user_id", userId)
    .maybeSingle();

  const status = (data?.status as SubscriptionStatus) ?? "none";
  const entitlement = entitlementFor(status);
  const isPremium = entitlement.generate;
  const trialEndsAt = data?.trial_end ?? null;

  let daysLeftInTrial: number | null = null;
  if (status === "trialing" && trialEndsAt) {
    daysLeftInTrial = Math.max(
      0,
      differenceInCalendarDays(new Date(trialEndsAt), new Date())
    );
  }

  return {
    plan: isPremium ? "premium" : "sample",
    status,
    trialEndsAt,
    // Prefer the real Stripe window; fall back to the length pinned at
    // checkout for the brief period before the first webhook lands.
    trialLengthDays:
      trialDaysFromDates(data?.trial_start ?? null, trialEndsAt) ??
      (typeof data?.trial_days === "number" ? data.trial_days : null),
    currentPeriodEnd: data?.current_period_end ?? null,
    isPremium,
    daysLeftInTrial,
    shouldShowTrialBanner: status === "trialing",
    cancelAtPeriodEnd: data?.cancel_at_period_end ?? false,
    planName: data?.plan_name ?? null,
    entitlement,
  };
}

/** Resolve the user's plan tier (sample | premium). */
export async function getUserPlan(userId: string): Promise<PlanTier> {
  const { plan } = await getUserSubscriptionStatus(userId);
  return plan;
}

async function countAllTime(userId: string, table: "daily_plans") {
  const supabase = await createClient();
  const { count } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  return count ?? 0;
}

async function countThisMonth(userId: string, table: "weekly_plans") {
  const supabase = await createClient();
  const monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
  const { count } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("week_start", monthStart);
  return count ?? 0;
}

export async function canGenerateDailyPlan(userId: string): Promise<boolean> {
  const plan = await getUserPlan(userId);
  if (plan === "premium") return true;
  // Sample: one lifetime preview plan.
  const used = await countAllTime(userId, "daily_plans");
  return used < PLAN_LIMITS.sample.dailyPlansTotal;
}

export async function canGenerateWeeklyPlan(userId: string): Promise<boolean> {
  const plan = await getUserPlan(userId);
  const used = await countThisMonth(userId, "weekly_plans");
  return used < PLAN_LIMITS[plan].weeklyPlansPerMonth;
}

export async function canUsePremiumFeature(
  userId: string,
  feature: PremiumFeature
): Promise<boolean> {
  const plan = await getUserPlan(userId);
  return PLAN_LIMITS[plan].premiumFeatures.includes(feature);
}
