import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";
import {
  WeeklyPlanView,
  WeeklyPlanEmpty,
} from "@/components/dailyflow/weekly-plan-view";
import type { WeeklyPlan } from "@/types/dailyflow";

export const metadata: Metadata = { title: "Week at a glance — Mellowa" };

export default async function WeeklyPlanPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: plan } = await supabase
    .from("weekly_plans")
    .select("*")
    .eq("user_id", user.id)
    .order("week_start", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!plan) return <WeeklyPlanEmpty />;

  return <WeeklyPlanView plan={plan as WeeklyPlan} />;
}
