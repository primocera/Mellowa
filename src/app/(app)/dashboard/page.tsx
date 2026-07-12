import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Sun,
  CalendarDays,
  Repeat,
  BookOpen,
  Plus,
  Sparkles,
} from "lucide-react";
import { requireUser } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";
import type { DailyCheckin, Habit, HabitLog, WeeklyPlan } from "@/types/dailyflow";

export const metadata: Metadata = { title: "Dashboard — DailyFlow" };

const GENTLE_REMINDERS = [
  "Small steps count. One doable thing today is enough.",
  "Your plan should fit your day — not the other way around.",
  "A calm routine beats a perfect one.",
  "Progress is quiet. Showing up today is progress.",
  "You don't need to earn rest. Build it in.",
];

function ScalePill({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-xl bg-[#FAF7F2] px-4 py-3 text-center">
      <p className="text-lg font-semibold text-[#1F2937]">{value ?? "—"}</p>
      <p className="text-xs text-[#6B7280]">{label}</p>
    </div>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const today = new Date().toISOString().slice(0, 10);

  const [profileRes, checkinRes, planRes, habitsRes, logsRes, weeklyRes] =
    await Promise.all([
      supabase
        .from("wellbeing_profiles")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("daily_checkins")
        .select("*")
        .eq("user_id", user.id)
        .order("checkin_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("daily_plans")
        .select("id")
        .eq("user_id", user.id)
        .eq("plan_date", today)
        .maybeSingle(),
      supabase
        .from("habits")
        .select("*")
        .eq("user_id", user.id)
        .eq("active", true)
        .order("created_at"),
      supabase
        .from("habit_logs")
        .select("*")
        .eq("user_id", user.id)
        .eq("log_date", today),
      supabase
        .from("weekly_plans")
        .select("*")
        .eq("user_id", user.id)
        .order("week_start", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  // First visit → onboarding
  if (!profileRes.data) redirect("/onboarding");

  const latestCheckin = checkinRes.data as DailyCheckin | null;
  const hasCheckinToday = latestCheckin?.checkin_date === today;
  const hasPlanToday = !!planRes.data;
  const habits = (habitsRes.data ?? []) as Habit[];
  const todayLogs = (logsRes.data ?? []) as HabitLog[];
  const weeklyPlan = weeklyRes.data as WeeklyPlan | null;

  const reminder =
    GENTLE_REMINDERS[new Date().getDate() % GENTLE_REMINDERS.length];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-[#1F2937]">
        Your day, simply
      </h1>

      {/* 1. Today status */}
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <Sun className="h-4 w-4 text-[#7C9A92]" />
          <h2 className="font-medium text-[#1F2937]">Today</h2>
        </div>
        {hasPlanToday ? (
          <>
            <p className="mt-1 text-sm text-[#6B7280]">Your plan for today is ready.</p>
            <Link
              href="/today"
              className="mt-4 inline-block rounded-xl bg-[#7C9A92] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#6D8C7D]"
            >
              Open today&apos;s plan
            </Link>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-[#6B7280]">
              {hasCheckinToday
                ? "Check-in done — generate your plan for today."
                : "Start with a 1-minute check-in to get your plan."}
            </p>
            <Link
              href="/check-in"
              className="mt-4 inline-block rounded-xl bg-[#7C9A92] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#6D8C7D]"
            >
              Start today&apos;s check-in
            </Link>
          </>
        )}
      </div>

      {/* 2. Energy & mood snapshot */}
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="font-medium text-[#1F2937]">How you&apos;ve been</h2>
        {latestCheckin ? (
          <>
            <p className="mt-1 text-xs text-[#6B7280]">
              Last check-in: {latestCheckin.checkin_date}
            </p>
            <div className="mt-3 grid grid-cols-4 gap-2">
              <ScalePill label="Energy" value={latestCheckin.energy_level} />
              <ScalePill label="Mood" value={latestCheckin.mood_level} />
              <ScalePill label="Stress" value={latestCheckin.stress_level} />
              <ScalePill label="Sleep" value={latestCheckin.sleep_quality} />
            </div>
          </>
        ) : (
          <p className="mt-1 text-sm text-[#6B7280]">
            No check-ins yet — your snapshot will show up here.
          </p>
        )}
      </div>

      {/* 3. Habit focus */}
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <Repeat className="h-4 w-4 text-[#7C9A92]" />
          <h2 className="font-medium text-[#1F2937]">Habits</h2>
        </div>
        {habits.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {habits.slice(0, 5).map((habit) => {
              const done = todayLogs.some(
                (l) => l.habit_id === habit.id && l.completed
              );
              return (
                <li
                  key={habit.id}
                  className="flex items-center justify-between rounded-xl bg-[#FAF7F2] px-4 py-2.5 text-sm"
                >
                  <span className="text-[#1F2937]">{habit.name}</span>
                  <span
                    className={
                      done
                        ? "rounded-full bg-[#DCFCE7] px-2.5 py-0.5 text-xs font-medium text-[#166534]"
                        : "rounded-full bg-white px-2.5 py-0.5 text-xs text-[#6B7280]"
                    }
                  >
                    {done ? "Done today" : "Not yet"}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-[#6B7280]">
            No habits yet. Start with one small, doable habit.
          </p>
        )}
      </div>

      {/* 4. Weekly plan */}
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-[#7C9A92]" />
          <h2 className="font-medium text-[#1F2937]">This week</h2>
        </div>
        {weeklyPlan?.weekly_focus ? (
          <>
            <p className="mt-1 text-sm text-[#1F2937]">{weeklyPlan.weekly_focus}</p>
            <Link
              href="/weekly-plan"
              className="mt-3 inline-block text-sm font-medium text-[#7C9A92] hover:underline"
            >
              Open weekly plan →
            </Link>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-[#6B7280]">
              No weekly plan yet — generate one to get a simple structure and
              shopping list.
            </p>
            <Link
              href="/weekly-plan"
              className="mt-3 inline-block text-sm font-medium text-[#7C9A92] hover:underline"
            >
              Generate weekly plan →
            </Link>
          </>
        )}
      </div>

      {/* 5. Gentle reminder */}
      <div className="rounded-2xl bg-[#EDE9FE]/60 p-6">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[#7C9A92]" />
          <p className="text-sm text-[#1F2937]">{reminder}</p>
        </div>
      </div>

      {/* 6. Quick actions */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Link
          href="/check-in"
          className="flex flex-col items-center gap-2 rounded-2xl bg-white p-4 text-center text-sm text-[#1F2937] shadow-sm transition hover:shadow"
        >
          <Sun className="h-5 w-5 text-[#7C9A92]" />
          Daily check-in
        </Link>
        <Link
          href="/weekly-plan"
          className="flex flex-col items-center gap-2 rounded-2xl bg-white p-4 text-center text-sm text-[#1F2937] shadow-sm transition hover:shadow"
        >
          <CalendarDays className="h-5 w-5 text-[#7C9A92]" />
          Weekly plan
        </Link>
        <Link
          href="/habits"
          className="flex flex-col items-center gap-2 rounded-2xl bg-white p-4 text-center text-sm text-[#1F2937] shadow-sm transition hover:shadow"
        >
          <Plus className="h-5 w-5 text-[#7C9A92]" />
          Add habit
        </Link>
        <Link
          href="/journal"
          className="flex flex-col items-center gap-2 rounded-2xl bg-white p-4 text-center text-sm text-[#1F2937] shadow-sm transition hover:shadow"
        >
          <BookOpen className="h-5 w-5 text-[#7C9A92]" />
          Journal
        </Link>
      </div>
    </div>
  );
}
