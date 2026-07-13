import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";
import { TodayPlanV2 } from "@/components/dailyflow/today-plan-v2";

export const metadata: Metadata = { title: "Today — Mellowa" };

export default async function TodayPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const today = new Date().toISOString().slice(0, 10);

  const [planRes, profileRes] = await Promise.all([
    supabase
      .from("daily_plans")
      .select("*")
      .eq("user_id", user.id)
      .eq("plan_date", today)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("wellbeing_profiles")
      .select("show_macros")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const plan = planRes.data;
  const showMacros = profileRes.data?.show_macros ?? true;

  // No plan, or an older plan from before the v2 format → fresh check-in.
  if (!plan || !plan.meal_cards) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-[#1F2937]">
          {plan ? "Time for a fresh plan" : "No plan yet today"}
        </h1>
        <p className="mt-2 text-sm text-[#6B7280]">
          A quick check-in is all it takes — your plan adapts to how today
          actually feels, with meal ideas, gentle movement and a calm reset.
        </p>
        <Link
          href="/check-in"
          className="mt-6 inline-block rounded-xl bg-[#7C9A92] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#6D8C7D]"
        >
          Start today&apos;s check-in
        </Link>
      </div>
    );
  }

  return <TodayPlanV2 plan={plan} showMacros={showMacros} />;
}
