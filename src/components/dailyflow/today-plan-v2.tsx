"use client";

import { useState } from "react";
import {
  Loader2,
  RefreshCw,
  Feather,
  Check,
  Droplets,
  Footprints,
  Wind,
  Brain,
  Sparkles,
  Moon,
  Target,
  ChevronDown,
} from "lucide-react";
import clsx from "clsx";
import { SaveMealButton } from "@/components/dailyflow/save-meal-button";
import { createClient } from "@/lib/supabase/client";
import { PlanFeedback } from "@/components/dailyflow/plan-feedback";
import type {
  MealCardType,
  MovementMomentType,
} from "@/schemas/ai-output-v2";

// ---- shapes stored on the plan row (jsonb) ----
type Summary = { main_focus: string; energy_match?: string; short_note?: string };
type Hydration = { goal: string; timing: string[] };
type Breathing = { name: string; duration_minutes: number; when_to_use?: string; steps: string[]; gentle_note?: string };
type Meditation = { name: string; duration_minutes: number; script: string[]; journal_prompt?: string };
type Relaxation = { name: string; duration_minutes: number; steps: string[]; best_for?: string };
type FocusBlock = { main_task: string; method?: string; break_reminder?: string };
type Evening = { time?: string; steps: string[]; simple_version?: string };
type Habit = { habit: string; minimum_version: string; tracking_question?: string };

type PlanRow = {
  id: string;
  plan_summary: Summary | null;
  plan_intensity: string | null;
  plan_mode?: string | null;
  meal_cards: MealCardType[] | null;
  hydration_plan_v2: Hydration | null;
  movement_plan: MovementMomentType | null;
  breathing_exercise: Breathing | null;
  meditation_or_reflection: Meditation | null;
  relaxation_technique: Relaxation | null;
  focus_plan: FocusBlock | null;
  evening_routine: Evening | null;
  habit_focus: Habit | null;
  encouragement: string | null;
  safety_note: string | null;
};

const INTENSITY_LABELS: Record<string, string> = {
  normal: "Balanced day",
  low_energy: "Low-energy day",
  high_stress: "Calm day",
  busy_day: "Busy day",
};

const MODE_LABELS: Record<string, string> = {
  minimum: "Minimum day",
  balanced: "Balanced day",
  reset: "Reset day",
  custom: "Your custom day",
};

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function Section({
  icon,
  title,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="font-medium text-[#1F2937]">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function MacroPills({ macros }: { macros: MealCardType["approximate_macros"] }) {
  const items = [
    `${Math.round(macros.calories)} kcal`,
    `P ${Math.round(macros.protein_g)}g`,
    `C ${Math.round(macros.carbs_g)}g`,
    `F ${Math.round(macros.fat_g)}g`,
  ];
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {items.map((t) => (
        <span
          key={t}
          className="rounded-full bg-[#FAF7F2] px-2.5 py-0.5 text-xs text-[#6B7280]"
        >
          {t}
        </span>
      ))}
      <span className="rounded-full bg-[#FAF7F2] px-2.5 py-0.5 text-xs text-[#9CA3AF]">
        approximate
      </span>
    </div>
  );
}

export function TodayPlanV2({
  plan,
  showMacros,
  completedKeys = [],
}: {
  plan: PlanRow;
  showMacros: boolean;
  completedKeys?: string[];
}) {
  const [meals, setMeals] = useState<MealCardType[]>(plan.meal_cards ?? []);
  // Per-card hide control (Prompt 7): hiding persists as the account-wide
  // opt-out; estimates never reappear without an explicit opt-in.
  const [macrosVisible, setMacrosVisible] = useState(showMacros);
  async function hideMacros() {
    setMacrosVisible(false);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from("wellbeing_profiles")
          .update({ show_macros: false })
          .eq("user_id", user.id);
      }
    } catch {
      // UI already hidden; preference retry available in Settings.
    }
  }
  const [movement, setMovement] = useState<MovementMomentType | null>(
    plan.movement_plan
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [simplifying, setSimplifying] = useState(false);
  const [doneItems, setDoneItems] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(completedKeys.map((k) => [k, true]))
  );

  const summary = plan.plan_summary;
  const intensity = plan.plan_intensity ?? "normal";

  // Optimistic toggle + persist to plan_completions. Reverts on failure.
  const toggleDone = (key: string) => {
    const next = !doneItems[key];
    setDoneItems((d) => ({ ...d, [key]: next }));
    fetch("/api/plan/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan_id: plan.id, item_key: key, done: next }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("save failed");
      })
      .catch(() => {
        setDoneItems((d) => ({ ...d, [key]: !next }));
      });
  };

  async function regenerateMeal(mealType: string, reason: string) {
    setBusy(`meal:${mealType}`);
    setMessage(null);
    try {
      const res = await fetch("/api/ai/regenerate-section", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_id: plan.id,
          section_name: "meal_card",
          meal_type: mealType,
          reason,
        }),
      });
      const data = await res.json();
      if (data.blocked) setMessage(data.user_message);
      else if (res.ok && data.section) {
        setMeals((prev) =>
          prev.map((m) => (m.meal_type === mealType ? data.section : m))
        );
      } else setMessage("Couldn't update that meal — try again in a moment.");
    } catch {
      setMessage("Couldn't update that meal — try again in a moment.");
    }
    setBusy(null);
  }

  async function regenerateMovement() {
    setBusy("movement");
    setMessage(null);
    try {
      const res = await fetch("/api/ai/regenerate-section", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_id: plan.id,
          section_name: "movement_moment",
          reason: "make_easier",
        }),
      });
      const data = await res.json();
      if (data.blocked) setMessage(data.user_message);
      else if (res.ok && data.section) setMovement(data.section);
      else setMessage("Couldn't update movement — try again in a moment.");
    } catch {
      setMessage("Couldn't update movement — try again in a moment.");
    }
    setBusy(null);
  }

  async function simplifyDay() {
    setSimplifying(true);
    setMessage(null);
    // Simplify each meal, then movement.
    for (const meal of meals) {
      try {
        const res = await fetch("/api/ai/regenerate-section", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan_id: plan.id,
            section_name: "meal_card",
            meal_type: meal.meal_type,
            reason: "simplify",
          }),
        });
        const data = await res.json();
        if (res.ok && data.section) {
          setMeals((prev) =>
            prev.map((m) => (m.meal_type === meal.meal_type ? data.section : m))
          );
        }
      } catch {
        /* keep original on failure */
      }
    }
    await regenerateMovement();
    setSimplifying(false);
  }

  return (
    <div className="space-y-4">
      {/* 1. Header + summary */}
      <div className="rounded-2xl bg-[#7C9A92] p-6 text-white">
        <p className="text-sm text-white/80">{greeting()}</p>
        <h1 className="mt-1 text-lg font-semibold">
          {summary?.main_focus ?? "Your gentle plan for today"}
        </h1>
        {summary?.short_note && (
          <p className="mt-1 text-sm text-white/90">{summary.short_note}</p>
        )}
        <span className="mt-3 inline-block rounded-full bg-white/20 px-3 py-0.5 text-xs font-medium">
          {(plan.plan_mode && MODE_LABELS[plan.plan_mode]) ??
            INTENSITY_LABELS[intensity] ??
            "Balanced day"}
        </span>
      </div>

      {message && (
        <div className="rounded-xl bg-[#EEF2FF] px-4 py-3 text-sm text-[#1F2937]">
          {message}
        </div>
      )}

      {/* 2. Meal cards */}
      <div className="space-y-3">
        <h2 className="px-1 text-sm font-medium uppercase tracking-wide text-[#9CA3AF]">
          Meal rhythm
        </h2>
        {meals.map((meal, mealIndex) => (
          <div
            key={`${meal.meal_type}-${mealIndex}`}
            className="rounded-2xl bg-white p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-[#7C9A92]">
                  {meal.meal_type}
                </p>
                <h3 className="mt-0.5 font-medium text-[#1F2937]">{meal.title}</h3>
                {meal.short_description && (
                  <p className="mt-0.5 text-sm text-[#6B7280]">
                    {meal.short_description}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span className="rounded-full bg-[#FAF7F2] px-2.5 py-0.5 text-xs text-[#6B7280]">
                  {meal.total_time_minutes} min · {meal.difficulty}
                </span>
                <SaveMealButton meal={meal} />
              </div>
            </div>

            {macrosVisible && (
              <div className="flex items-center gap-2">
                <MacroPills macros={meal.approximate_macros} />
                <button
                  onClick={hideMacros}
                  className="text-xs text-[#9CA3AF] underline hover:text-[#6B7280]"
                >
                  Hide
                </button>
              </div>
            )}

            <details className="group mt-3">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-[#7C9A92]">
                <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
                Ingredients & steps
              </summary>
              <div className="mt-2 space-y-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-[#9CA3AF]">
                    Ingredients
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {meal.ingredients.map((ing, i) => (
                      <li key={i} className="text-sm text-[#1F2937]">
                        {ing.amount ? `${ing.amount} ` : ""}
                        {ing.name}
                        {ing.optional && (
                          <span className="text-[#9CA3AF]"> (optional)</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-[#9CA3AF]">
                    Steps
                  </p>
                  <ol className="mt-1 space-y-1">
                    {meal.preparation_steps.map((s, i) => (
                      <li key={i} className="flex gap-2 text-sm text-[#1F2937]">
                        <span className="text-[#9CA3AF]">{i + 1}.</span>
                        {s}
                      </li>
                    ))}
                  </ol>
                </div>
                {meal.low_energy_swap && (
                  <p className="text-xs text-[#6B7280]">
                    <span className="font-medium">Low-energy swap:</span>{" "}
                    {meal.low_energy_swap}
                  </p>
                )}
                <p className="text-xs text-[#9CA3AF]">{meal.safety_note}</p>
              </div>
            </details>

            <div className="mt-3 flex gap-1.5">
              <button
                onClick={() => regenerateMeal(meal.meal_type, "different_meals")}
                disabled={busy === `meal:${meal.meal_type}` || simplifying}
                className="flex items-center gap-1 rounded-lg border border-[#E5E1DA] px-2.5 py-1.5 text-xs text-[#6B7280] transition hover:border-[#7C9A92]/50 hover:text-[#1F2937] disabled:opacity-50"
              >
                {busy === `meal:${meal.meal_type}` ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                Replace
              </button>
              <button
                onClick={() => regenerateMeal(meal.meal_type, "simplify")}
                disabled={busy === `meal:${meal.meal_type}` || simplifying}
                className="flex items-center gap-1 rounded-lg border border-[#E5E1DA] px-2.5 py-1.5 text-xs text-[#6B7280] transition hover:border-[#7C9A92]/50 hover:text-[#1F2937] disabled:opacity-50"
              >
                <Feather className="h-3 w-3" />
                Simplify
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 3. Hydration */}
      {plan.hydration_plan_v2 && (
        <Section
          icon={<Droplets className="h-4 w-4 text-[#7C9A92]" />}
          title="Hydration"
        >
          <p className="mt-1 text-sm text-[#1F2937]">{plan.hydration_plan_v2.goal}</p>
          <ul className="mt-2 space-y-1">
            {plan.hydration_plan_v2.timing.map((t, i) => (
              <li key={i} className="text-sm text-[#6B7280]">
                • {t}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* 4. Movement */}
      {movement && (
        <Section
          icon={<Footprints className="h-4 w-4 text-[#7C9A92]" />}
          title="Movement moment"
          action={
            <button
              onClick={regenerateMovement}
              disabled={busy === "movement" || simplifying}
              className="flex items-center gap-1 rounded-lg border border-[#E5E1DA] px-2.5 py-1.5 text-xs text-[#6B7280] transition hover:border-[#7C9A92]/50 hover:text-[#1F2937] disabled:opacity-50"
            >
              {busy === "movement" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Feather className="h-3 w-3" />
              )}
              Make easier
            </button>
          }
        >
          <p className="mt-1 text-sm font-medium text-[#1F2937]">
            {movement.title}
            <span className="ml-2 font-normal text-[#9CA3AF]">
              {movement.duration_minutes} min · {movement.intensity.replace(/_/g, " ")}
            </span>
          </p>
          <ol className="mt-2 space-y-1">
            {movement.steps.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm text-[#1F2937]">
                <span className="text-[#9CA3AF]">{i + 1}.</span>
                {s}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-[#9CA3AF]">{movement.caution_note}</p>
          <DoneToggle
            done={!!doneItems.movement}
            onClick={() => toggleDone("movement")}
          />
        </Section>
      )}

      {/* 5. Calm reset */}
      {(plan.breathing_exercise ||
        plan.meditation_or_reflection ||
        plan.relaxation_technique) && (
        <h2 className="px-1 text-sm font-medium uppercase tracking-wide text-[#9CA3AF]">
          Calm reset
        </h2>
      )}
      {plan.breathing_exercise && (
        <Section
          icon={<Wind className="h-4 w-4 text-[#7C9A92]" />}
          title={plan.breathing_exercise.name}
        >
          <p className="mt-0.5 text-xs text-[#9CA3AF]">
            {plan.breathing_exercise.duration_minutes} min ·{" "}
            {plan.breathing_exercise.when_to_use}
          </p>
          <ol className="mt-2 space-y-1">
            {plan.breathing_exercise.steps.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm text-[#1F2937]">
                <span className="text-[#9CA3AF]">{i + 1}.</span>
                {s}
              </li>
            ))}
          </ol>
          {plan.breathing_exercise.gentle_note && (
            <p className="mt-2 text-xs text-[#9CA3AF]">
              {plan.breathing_exercise.gentle_note}
            </p>
          )}
          <DoneToggle
            done={!!doneItems.breathing}
            onClick={() => toggleDone("breathing")}
          />
        </Section>
      )}
      {plan.meditation_or_reflection && (
        <Section
          icon={<Brain className="h-4 w-4 text-[#7C9A92]" />}
          title={plan.meditation_or_reflection.name}
        >
          <p className="mt-0.5 text-xs text-[#9CA3AF]">
            {plan.meditation_or_reflection.duration_minutes} min
          </p>
          <div className="mt-2 space-y-1">
            {plan.meditation_or_reflection.script.map((s, i) => (
              <p key={i} className="text-sm italic text-[#1F2937]">
                {s}
              </p>
            ))}
          </div>
          {plan.meditation_or_reflection.journal_prompt && (
            <p className="mt-2 rounded-xl bg-[#EDE9FE]/50 px-3 py-2 text-sm text-[#1F2937]">
              {plan.meditation_or_reflection.journal_prompt}
            </p>
          )}
        </Section>
      )}
      {plan.relaxation_technique && (
        <Section
          icon={<Sparkles className="h-4 w-4 text-[#7C9A92]" />}
          title={plan.relaxation_technique.name}
        >
          <p className="mt-0.5 text-xs text-[#9CA3AF]">
            {plan.relaxation_technique.duration_minutes} min ·{" "}
            {plan.relaxation_technique.best_for}
          </p>
          <ol className="mt-2 space-y-1">
            {plan.relaxation_technique.steps.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm text-[#1F2937]">
                <span className="text-[#9CA3AF]">{i + 1}.</span>
                {s}
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* 6. Focus block */}
      {plan.focus_plan && (
        <Section
          icon={<Target className="h-4 w-4 text-[#7C9A92]" />}
          title="Focus block"
        >
          <p className="mt-1 text-sm text-[#1F2937]">{plan.focus_plan.main_task}</p>
          {plan.focus_plan.method && (
            <p className="mt-1 text-sm text-[#6B7280]">{plan.focus_plan.method}</p>
          )}
          {plan.focus_plan.break_reminder && (
            <p className="mt-1 text-xs text-[#9CA3AF]">
              {plan.focus_plan.break_reminder}
            </p>
          )}
        </Section>
      )}

      {/* 7. Evening wind-down */}
      {plan.evening_routine && (
        <Section
          icon={<Moon className="h-4 w-4 text-[#7C9A92]" />}
          title="Evening wind-down"
        >
          {plan.evening_routine.time && (
            <p className="mt-0.5 text-xs text-[#9CA3AF]">
              {plan.evening_routine.time}
            </p>
          )}
          <ul className="mt-2 space-y-1">
            {plan.evening_routine.steps.map((s, i) => (
              <li key={i} className="text-sm text-[#1F2937]">
                • {s}
              </li>
            ))}
          </ul>
          {plan.evening_routine.simple_version && (
            <p className="mt-2 text-xs text-[#6B7280]">
              <span className="font-medium">Simple version:</span>{" "}
              {plan.evening_routine.simple_version}
            </p>
          )}
        </Section>
      )}

      {/* 8. One small habit */}
      {plan.habit_focus && (
        <Section
          icon={<Check className="h-4 w-4 text-[#7C9A92]" />}
          title="One small habit"
        >
          <p className="mt-1 text-sm text-[#1F2937]">{plan.habit_focus.habit}</p>
          {plan.habit_focus.minimum_version && (
            <p className="mt-1 text-sm text-[#6B7280]">
              Minimum version: {plan.habit_focus.minimum_version}
            </p>
          )}
          <DoneToggle
            done={!!doneItems.habit}
            onClick={() => toggleDone("habit")}
          />
        </Section>
      )}

      {/* Encouragement + safety */}
      {plan.encouragement && (
        <div className="rounded-2xl bg-[#EDE9FE]/60 p-5 text-sm text-[#1F2937]">
          {plan.encouragement}
        </div>
      )}
      {plan.safety_note && (
        <p className="px-2 text-xs text-[#9CA3AF]">{plan.safety_note}</p>
      )}

      {/* Gentle feedback (Prompt 10) */}
      <PlanFeedback planId={plan.id} />

      {/* This feels too much */}
      <button
        onClick={simplifyDay}
        disabled={simplifying}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[#E5E1DA] bg-white px-4 py-3 text-sm text-[#6B7280] transition hover:border-[#7C9A92]/50 hover:text-[#1F2937] disabled:opacity-60"
      >
        {simplifying ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Making today lighter...
          </>
        ) : (
          <>
            <Feather className="h-4 w-4" />
            This feels like too much — simplify my day
          </>
        )}
      </button>
    </div>
  );
}

function DoneToggle({ done, onClick }: { done: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "mt-3 flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-medium transition",
        done
          ? "bg-[#DCFCE7] text-[#166534]"
          : "bg-[#7C9A92] text-white hover:bg-[#6D8C7D]"
      )}
    >
      <Check className="h-3.5 w-3.5" />
      {done ? "Done" : "Mark done"}
    </button>
  );
}
