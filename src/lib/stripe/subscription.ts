import "server-only";
import { startOfMonth, format, differenceInCalendarDays } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import {
  PLAN_LIMITS,
  ACTIVE_STATUSES,
  type PlanTier,
  type PremiumFeature,
} from "./plans";

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
  currentPeriodEnd: string | null;
  isPremium: boolean;
  daysLeftInTrial: number | null;
  shouldShowTrialBanner: boolean;
  cancelAtPeriodEnd: boolean;
  planName: string | null;
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
    .select("status, trial_end, current_period_end, cancel_at_period_end, plan_name")
    .eq("user_id", userId)
    .maybeSingle();

  const status = (data?.status as SubscriptionStatus) ?? "none";
  const isPremium = ACTIVE_STATUSES.includes(status);
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
    currentPeriodEnd: data?.current_period_end ?? null,
    isPremium,
    daysLeftInTrial,
    shouldShowTrialBanner: status === "trialing",
    cancelAtPeriodEnd: data?.cancel_at_period_end ?? false,
    planName: data?.plan_name ?? null,
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
