"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format, subDays } from "date-fns";
import {
  Loader2,
  Plus,
  Sparkles,
  Check,
  Pause,
  Play,
  Trash2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Habit, HabitLog } from "@/types/dailyflow";
import clsx from "clsx";

type Suggestion = {
  name: string;
  category?: string;
  frequency?: string;
  minimum_version: string;
  why_it_helps?: string;
};

export function HabitsView({
  habits,
  logs,
  userId,
}: {
  habits: Habit[];
  logs: HabitLog[];
  userId: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const today = format(new Date(), "yyyy-MM-dd");

  const [newName, setNewName] = useState("");
  const [newMin, setNewMin] = useState("");
  const [adding, setAdding] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const last7 = Array.from({ length: 7 }, (_, i) =>
    format(subDays(new Date(), 6 - i), "yyyy-MM-dd")
  );

  const isDone = (habitId: string, date: string) =>
    logs.some((l) => l.habit_id === habitId && l.log_date === date && l.completed);

  async function addHabit(name: string, minimum: string, category = "", frequency = "daily") {
    if (!name.trim()) return;
    setAdding(true);
    await supabase.from("habits").insert({
      user_id: userId,
      name: name.trim(),
      minimum_version: minimum.trim(),
      category,
      frequency,
    });
    setNewName("");
    setNewMin("");
    setAdding(false);
    router.refresh();
  }

  async function toggleToday(habit: Habit) {
    setBusyId(habit.id);
    const done = isDone(habit.id, today);
    if (done) {
      await supabase
        .from("habit_logs")
        .delete()
        .eq("habit_id", habit.id)
        .eq("log_date", today);
    } else {
      await supabase.from("habit_logs").upsert(
        {
          user_id: userId,
          habit_id: habit.id,
          log_date: today,
          completed: true,
        },
        { onConflict: "habit_id,log_date" }
      );
    }
    setBusyId(null);
    router.refresh();
  }

  async function togglePause(habit: Habit) {
    setBusyId(habit.id);
    await supabase
      .from("habits")
      .update({ active: !habit.active })
      .eq("id", habit.id);
    setBusyId(null);
    router.refresh();
  }

  async function removeHabit(habit: Habit) {
    setBusyId(habit.id);
    await supabase.from("habits").delete().eq("id", habit.id);
    setBusyId(null);
    router.refresh();
  }

  async function suggest() {
    setSuggesting(true);
    try {
      const res = await fetch("/api/ai/habit-plan", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.suggestions?.habits) {
        setSuggestions(data.suggestions.habits);
      }
    } catch {
      // quiet fail — user can retry
    }
    setSuggesting(false);
  }

  const active = habits.filter((h) => h.active);
  const paused = habits.filter((h) => !h.active);

  return (
    <div className="space-y-4">
      {/* Today */}
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="font-medium text-[#1F2937]">Today</h2>
        {active.length === 0 ? (
          <p className="mt-1 text-sm text-[#6B7280]">
            No active habits yet — one small habit is a great start.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {active.map((habit) => {
              const done = isDone(habit.id, today);
              return (
                <li
                  key={habit.id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-[#FAF7F2] px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#1F2937]">{habit.name}</p>
                    {habit.minimum_version && (
                      <p className="truncate text-xs text-[#6B7280]">
                        Minimum: {habit.minimum_version}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => toggleToday(habit)}
                    disabled={busyId === habit.id}
                    className={clsx(
                      "flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium transition",
                      done
                        ? "bg-[#DCFCE7] text-[#166534]"
                        : "bg-[#7C9A92] text-white hover:bg-[#6D8C7D]"
                    )}
                  >
                    {busyId === habit.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    {done ? "Done" : "Mark done"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Weekly overview */}
      {active.length > 0 && (
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="font-medium text-[#1F2937]">This week</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="text-xs text-[#9CA3AF]">
                  <th className="pb-2 text-left font-medium">Habit</th>
                  {last7.map((d) => (
                    <th key={d} className="pb-2 text-center font-medium">
                      {format(new Date(d), "EE").slice(0, 2)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {active.map((habit) => (
                  <tr key={habit.id} className="border-t border-[#F3F0EA]">
                    <td className="max-w-[160px] truncate py-2 pr-2 text-[#1F2937]">
                      {habit.name}
                    </td>
                    {last7.map((d) => (
                      <td key={d} className="py-2 text-center">
                        <span
                          className={clsx(
                            "inline-block h-2.5 w-2.5 rounded-full",
                            isDone(habit.id, d) ? "bg-[#7C9A92]" : "bg-[#E5E1DA]"
                          )}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-[#9CA3AF]">
            Dots show done days — gaps are fine, they&apos;re part of real life.
          </p>
        </div>
      )}

      {/* Manage */}
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="font-medium text-[#1F2937]">Add a habit</h2>
        <div className="mt-3 space-y-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Habit — e.g. 10-minute walk after lunch"
            className="w-full rounded-xl border border-[#E5E1DA] px-4 py-2.5 text-sm text-[#1F2937] placeholder:text-[#9CA3AF] focus:border-[#7C9A92] focus:outline-none"
          />
          <input
            type="text"
            value={newMin}
            onChange={(e) => setNewMin(e.target.value)}
            placeholder="Minimum version — e.g. walk to the mailbox"
            className="w-full rounded-xl border border-[#E5E1DA] px-4 py-2.5 text-sm text-[#1F2937] placeholder:text-[#9CA3AF] focus:border-[#7C9A92] focus:outline-none"
          />
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => addHabit(newName, newMin)}
              disabled={adding || !newName.trim()}
              className="flex items-center gap-1.5 rounded-xl bg-[#7C9A92] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#6D8C7D] disabled:opacity-50"
            >
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add habit
            </button>
            <button
              onClick={suggest}
              disabled={suggesting}
              className="flex items-center gap-1.5 rounded-xl border border-[#E5E1DA] px-4 py-2.5 text-sm text-[#6B7280] transition hover:border-[#7C9A92]/50 hover:text-[#1F2937] disabled:opacity-50"
            >
              {suggesting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Suggest habits for me
            </button>
          </div>
        </div>

        {suggestions.length > 0 && (
          <ul className="mt-4 space-y-2">
            {suggestions.map((s, i) => (
              <li key={i} className="rounded-xl bg-[#FAF7F2] px-4 py-3">
                <p className="text-sm font-medium text-[#1F2937]">{s.name}</p>
                <p className="text-xs text-[#6B7280]">Minimum: {s.minimum_version}</p>
                {s.why_it_helps && (
                  <p className="mt-0.5 text-xs text-[#9CA3AF]">{s.why_it_helps}</p>
                )}
                <button
                  onClick={() => {
                    addHabit(s.name, s.minimum_version, s.category ?? "", s.frequency ?? "daily");
                    setSuggestions((prev) => prev.filter((_, j) => j !== i));
                  }}
                  className="mt-2 rounded-lg bg-[#7C9A92] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[#6D8C7D]"
                >
                  Add this habit
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Paused / delete */}
      {(active.length > 0 || paused.length > 0) && (
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="font-medium text-[#1F2937]">Manage habits</h2>
          <ul className="mt-3 space-y-2">
            {[...active, ...paused].map((habit) => (
              <li
                key={habit.id}
                className="flex items-center justify-between gap-3 rounded-xl bg-[#FAF7F2] px-4 py-2.5"
              >
                <p
                  className={clsx(
                    "min-w-0 truncate text-sm",
                    habit.active ? "text-[#1F2937]" : "text-[#9CA3AF]"
                  )}
                >
                  {habit.name}
                  {!habit.active && " (paused)"}
                </p>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    onClick={() => togglePause(habit)}
                    disabled={busyId === habit.id}
                    title={habit.active ? "Pause" : "Resume"}
                    className="rounded-lg border border-[#E5E1DA] p-2 text-[#6B7280] transition hover:text-[#1F2937]"
                  >
                    {habit.active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    onClick={() => removeHabit(habit)}
                    disabled={busyId === habit.id}
                    title="Delete"
                    className="rounded-lg border border-[#E5E1DA] p-2 text-[#6B7280] transition hover:text-[#991B1B]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
