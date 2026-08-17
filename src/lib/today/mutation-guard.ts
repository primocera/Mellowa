import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyPlanDay } from "@/lib/today/plan-day";
import { isValidTimeZone } from "@/lib/dates/local-day";

/**
 * MW-02: a content mutation (Adjust / regenerate section) may only touch the
 * user's CURRENT local-day plan.
 *
 * The surfaces only ever expose these actions for today's plan, so in normal
 * use this always passes. It exists to reject the boundary cases the daily
 * contract forbids: a tab left open across local midnight, a wrong device
 * clock, or a forged request that targets a past or future plan_date. Those
 * must be refused with a stable code rather than allowed to mutate a historical
 * day (or resurrect yesterday as "today").
 *
 * Returns "ok" when the plan is the user's current local day, "not_today" for a
 * past/future/cross-midnight plan, and (MW-03) "unavailable" when the timezone
 * read itself FAILED. A genuinely missing/invalid timezone still falls back to
 * UTC (the same conservative default the Today page uses), but a database read
 * error is NOT laundered into that fallback — the caller fails closed instead of
 * classifying the day against the wrong zone.
 */
export async function checkPlanIsToday(
  supabase: SupabaseClient,
  userId: string,
  planDate: string,
  now: Date = new Date()
): Promise<"ok" | "not_today" | "unavailable"> {
  const { data, error } = await supabase
    .from("wellbeing_profiles")
    .select("timezone")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return "unavailable";
  const tz = isValidTimeZone(data?.timezone) ? (data!.timezone as string) : "UTC";
  return classifyPlanDay(planDate, now, tz) === "today" ? "ok" : "not_today";
}
