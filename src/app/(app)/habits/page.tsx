import type { Metadata } from "next";
import { format, subDays } from "date-fns";
import { requireUser } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";
import { HabitsView } from "@/components/dailyflow/habits-view";
import type { Habit, HabitLog } from "@/types/dailyflow";

export const metadata: Metadata = { title: "Habits — Mellowa" };

export default async function HabitsPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const since = format(subDays(new Date(), 6), "yyyy-MM-dd");

  const [habitsRes, logsRes] = await Promise.all([
    supabase
      .from("habits")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at"),
    supabase
      .from("habit_logs")
      .select("*")
      .eq("user_id", user.id)
      .gte("log_date", since),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-[#1F2937]">
          Keep one thing easy to repeat
        </h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          Choose a habit and define the easiest version that still counts for
          you.
        </p>
      </div>
      <HabitsView
        habits={(habitsRes.data ?? []) as Habit[]}
        logs={(logsRes.data ?? []) as HabitLog[]}
        userId={user.id}
      />
    </div>
  );
}
