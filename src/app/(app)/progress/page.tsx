import type { Metadata } from "next";
import Link from "next/link";
import { format, subDays } from "date-fns";
import { requireUser } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";
import type { DailyCheckin, Habit, HabitLog } from "@/types/dailyflow";

export const metadata: Metadata = { title: "Progress — Mellowa" };

const METRICS = [
  { key: "energy_level", label: "Energy" },
  { key: "mood_level", label: "Mood" },
  { key: "stress_level", label: "Stress" },
  { key: "sleep_quality", label: "Sleep" },
] as const;

function MetricRow({
  label,
  checkins,
  metric,
}: {
  label: string;
  checkins: DailyCheckin[];
  metric: (typeof METRICS)[number]["key"];
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-[#6B7280]">{label}</p>
      <div className="flex items-end gap-1">
        {checkins.map((c) => {
          const v = c[metric];
          return (
            <div key={c.id} className="flex-1" title={`${c.checkin_date}: ${v ?? "—"}`}>
              <div
                className="w-full rounded-t bg-[#7C9A92]"
                style={{ height: `${(v ?? 0) * 8}px`, opacity: v ? 1 : 0.15 }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default async function ProgressPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const since14 = format(subDays(new Date(), 13), "yyyy-MM-dd");
  const since7 = format(subDays(new Date(), 6), "yyyy-MM-dd");

  const [checkinsRes, habitsRes, logsRes] = await Promise.all([
    supabase
      .from("daily_checkins")
      .select("*")
      .eq("user_id", user.id)
      .gte("checkin_date", since14)
      .order("checkin_date"),
    supabase
      .from("habits")
      .select("*")
      .eq("user_id", user.id)
      .eq("active", true),
    supabase
      .from("habit_logs")
      .select("*")
      .eq("user_id", user.id)
      .gte("log_date", since7)
      .eq("completed", true),
  ]);

  const checkins = (checkinsRes.data ?? []) as DailyCheckin[];
  const habits = (habitsRes.data ?? []) as Habit[];
  const logs = (logsRes.data ?? []) as HabitLog[];

  if (checkins.length === 0 && habits.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-[#1F2937]">Nothing here yet</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-[#6B7280]">
          After a few check-ins, this page will gently show how your energy,
          mood and habits are moving — no scores, no pressure.
        </p>
        <Link
          href="/check-in"
          className="mt-6 inline-block rounded-xl bg-[#7C9A92] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#6D8C7D]"
        >
          Start a check-in
        </Link>
      </div>
    );
  }

  // Gentle observations — carefully worded, never conclusive
  const wins: string[] = [];
  if (checkins.length >= 3) {
    wins.push(`You checked in ${checkins.length} times in the last two weeks — that's you showing up.`);
  } else if (checkins.length > 0) {
    wins.push("You've started checking in — that's already a step.");
  }
  const doneCount = logs.length;
  if (doneCount > 0) {
    wins.push(`You completed a habit ${doneCount} ${doneCount === 1 ? "time" : "times"} this week.`);
  }
  const goodSleepDays = checkins.filter((c) => (c.sleep_quality ?? 0) >= 4).length;
  if (goodSleepDays >= 2) {
    wins.push(`You had ${goodSleepDays} nights of solid sleep recently — you may notice those days feel a little lighter.`);
  }

  return (
    <div className="space-y-4">
      <div className="mb-2">
        <h1 className="text-2xl font-semibold tracking-tight text-[#1F2937]">
          Progress
        </h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          Gentle patterns, not report cards. Missed days are part of it.
        </p>
      </div>

      {/* Check-in history */}
      {checkins.length > 0 && (
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="font-medium text-[#1F2937]">Last two weeks</h2>
          <p className="mt-0.5 text-xs text-[#9CA3AF]">
            {checkins[0].checkin_date} → {checkins[checkins.length - 1].checkin_date}
          </p>
          <div className="mt-4 space-y-4">
            {METRICS.map((m) => (
              <MetricRow key={m.key} label={m.label} checkins={checkins} metric={m.key} />
            ))}
          </div>
        </div>
      )}

      {/* Habit summary */}
      {habits.length > 0 && (
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="font-medium text-[#1F2937]">Habits this week</h2>
          <ul className="mt-3 space-y-2">
            {habits.map((habit) => {
              const count = logs.filter((l) => l.habit_id === habit.id).length;
              return (
                <li
                  key={habit.id}
                  className="flex items-center justify-between rounded-xl bg-[#FAF7F2] px-4 py-2.5 text-sm"
                >
                  <span className="text-[#1F2937]">{habit.name}</span>
                  <span className="text-[#6B7280]">
                    {count} {count === 1 ? "day" : "days"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Recent wins */}
      {wins.length > 0 && (
        <div className="rounded-2xl bg-[#DCFCE7]/60 p-6">
          <h2 className="font-medium text-[#1F2937]">Worth noticing</h2>
          <ul className="mt-2 space-y-1.5">
            {wins.map((w, i) => (
              <li key={i} className="text-sm text-[#1F2937]">
                • {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Weekly reflection (Prompt 11) — supportive, never a report card */}
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="font-medium text-[#1F2937]">A gentle weekly reflection</h2>
        <p className="mt-1 text-sm text-[#6B7280]">
          No scores, no streaks. Just three small questions, whenever you like:
        </p>
        <ul className="mt-3 space-y-1.5 text-sm text-[#1F2937]">
          <li>• What felt a little easier this week than before?</li>
          <li>• Which day felt best — and what was different about it?</li>
          <li>• What&apos;s one small thing worth keeping next week?</li>
        </ul>
        <Link
          href="/journal"
          className="mt-4 inline-block rounded-xl border border-[#E5E1DA] px-4 py-2.5 text-sm font-medium text-[#1F2937] transition hover:border-[#7C9A92]/50"
        >
          Reflect in your journal
        </Link>
      </div>

      <p className="px-2 text-xs text-[#9CA3AF]">
        These are gentle observations, not health conclusions. Patterns here
        could be worth exploring, nothing more.
      </p>
    </div>
  );
}
