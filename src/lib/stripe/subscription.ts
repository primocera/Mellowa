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

/**
 * MW-03: did the billing-provider read SUCCEED?
 * - `available`   → the status below is verified truth.
 * - `unavailable` → the read failed. `status` is forced to a safe "none" (no
 *   premium is ever assumed we could not confirm), but callers MUST NOT present
 *   that as a definitive Free/Sample plan, and MUST deny new generation even if
 *   a separate usage-count read happens to succeed.
 */
export type BillingAvailability = "available" | "unavailable";

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
  /**
   * MW-03: whether billing could be verified at all. When `unavailable`, the
   * UI must show a temporary-problem state (not Free/Sample) and every new
   * generation is denied.
   */
  billing: BillingAvailability;
}

/**
 * Single source of truth for a user's subscription state.
 * Premium = Stripe status trialing or active.
 */
export async function getUserSubscriptionStatus(
  userId: string
): Promise<UserSubscriptionStatus> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subscriptions")
    .select(
      "status, trial_start, trial_end, current_period_end, cancel_at_period_end, plan_name, trial_days"
    )
    .eq("user_id", userId)
    .maybeSingle();

  // MW-04: fail closed on a read error. An unverifiable status resolves to
  // "none", whose entitlement grants no premium generation — we never assume
  // Premium (or a trial) we could not confirm.
  // MW-03: additionally surface the read outcome as `billing`, so callers can
  // distinguish "verified no subscription" (Free/Sample) from "could not verify"
  // (temporary-problem state) instead of collapsing both into "none".
  const billing: BillingAvailability = error ? "unavailable" : "available";
  const status = (error ? "none" : (data?.status as SubscriptionStatus)) ?? "none";
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
    billing,
  };
}

/** Resolve the user's plan tier (sample | premium). */
export async function getUserPlan(userId: string): Promise<PlanTier> {
  const { plan } = await getUserSubscriptionStatus(userId);
  return plan;
}

// MW-04: a failed count returns null (NOT 0). A swallowed error that became 0
// would read as "no usage yet" and grant an extra free generation, so callers
// must treat null as "cannot verify" and deny.
async function countAllTime(userId: string, table: "daily_plans"): Promise<number | null> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) return null;
  return count ?? 0;
}

async function countThisMonth(userId: string, table: "weekly_plans"): Promise<number | null> {
  const supabase = await createClient();
  const monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("week_start", monthStart);
  if (error) return null;
  return count ?? 0;
}

export async function canGenerateDailyPlan(userId: string): Promise<boolean> {
  const sub = await getUserSubscriptionStatus(userId);
  // MW-03: an unavailable billing read denies new generation even if the usage
  // count below reads cleanly — "could not verify" is never a sample allowance.
  if (sub.billing === "unavailable") return false;
  if (sub.plan === "premium") return true;
  // Sample: one lifetime preview plan. Fail closed if the quota read failed —
  // a count we could not verify must never grant a generation.
  const used = await countAllTime(userId, "daily_plans");
  if (used === null) return false;
  return used < PLAN_LIMITS.sample.dailyPlansTotal;
}

export async function canGenerateWeeklyPlan(userId: string): Promise<boolean> {
  const sub = await getUserSubscriptionStatus(userId);
  if (sub.billing === "unavailable") return false; // MW-03: fail closed
  const used = await countThisMonth(userId, "weekly_plans");
  if (used === null) return false; // fail closed on an unverifiable quota
  return used < PLAN_LIMITS[sub.plan].weeklyPlansPerMonth;
}

export async function canUsePremiumFeature(
  userId: string,
  feature: PremiumFeature
): Promise<boolean> {
  const sub = await getUserSubscriptionStatus(userId);
  if (sub.billing === "unavailable") return false; // MW-03: fail closed
  return PLAN_LIMITS[sub.plan].premiumFeatures.includes(feature);
}
