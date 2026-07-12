import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";
import { TodayPlan } from "@/components/dailyflow/today-plan";
import type { DailyPlan } from "@/types/dailyflow";

export const metadata: Metadata = { title: "Today — Mellowa" };

export default async function TodayPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const today = new Date().toISOString().slice(0, 10);

  const { data: plan } = await supabase
    .from("daily_plans")
    .select("*")
    .eq("user_id", user.id)
    .eq("plan_date", today)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!plan) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-[#1F2937]">No plan yet today</h1>
        <p className="mt-2 text-sm text-[#6B7280]">
          A quick check-in is all it takes — your plan adapts to how today
          actually feels.
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

  return <TodayPlan plan={plan as DailyPlan} />;
}
