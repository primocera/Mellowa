import "server-only";
import { startOfMonth, format } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import {
  PLAN_LIMITS,
  ACTIVE_STATUSES,
  type PlanTier,
  type PremiumFeature,
} from "./plans";

/** Resolve the user's current plan tier from the subscriptions table. */
export async function getUserPlan(userId: string): Promise<PlanTier> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("subscriptions")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();

  if (data?.status && ACTIVE_STATUSES.includes(data.status)) return "pro";
  return "free";
}

async function countThisMonth(userId: string, table: "daily_plans" | "weekly_plans") {
  const supabase = await createClient();
  const monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");
  const dateColumn = table === "daily_plans" ? "plan_date" : "week_start";
  const { count } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte(dateColumn, monthStart);
  return count ?? 0;
}

export async function canGenerateDailyPlan(userId: string): Promise<boolean> {
  const plan = await getUserPlan(userId);
  const used = await countThisMonth(userId, "daily_plans");
  return used < PLAN_LIMITS[plan].dailyPlansPerMonth;
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
