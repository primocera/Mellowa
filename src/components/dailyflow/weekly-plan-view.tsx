"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Copy, Check, Feather, CalendarPlus } from "lucide-react";
import type { WeeklyPlan } from "@/types/dailyflow";
import { errorCopy } from "@/lib/microcopy/errors";
import {
  carryForwardEffects,
  reflectionSelectionsFromRow,
} from "@/lib/week/reflection";

/**
 * MW-V9-07: before the AI creates next week, show exactly what it will apply —
 * the carry-forward the user chose, plus a plain note that stable preferences
 * and meal continuity always apply. Read-only review with edit links; nothing
 * generates until the user presses the button below it.
 */
function NextWeekReview() {
  const [effects, setEffects] = useState<string[] | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/week/reflection")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!active || !d) return;
        setEffects(carryForwardEffects(reflectionSelectionsFromRow(d.reflection)));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="rounded-2xl border border-[#E5E1DA] bg-white p-4 text-sm">
      <p className="font-medium text-[#1F2937]">What next week will use</p>
      {effects && effects.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5 text-[#6B7280]">
          {effects.map((e) => (
            <li key={e}>• {e}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-[#6B7280]">
          Nothing carried forward — next week starts from your usual
          preferences.
        </p>
      )}
      <p className="mt-1.5 text-xs text-[#9CA3AF]">
        Your saved preferences and meal continuity always apply. Change these in{" "}
        <Link href="#carry-forward-heading" className="underline underline-offset-2">
          Carry forward
        </Link>{" "}
        or{" "}
        <Link href="/settings" className="underline underline-offset-2">
          preferences
        </Link>{" "}
        before you create the plan.
      </p>
    </div>
  );
}

type PlanItem = { title: string; description?: string; time_hint?: string };
type Section = { title: string; items: PlanItem[] };
type MealDay = { day: string; breakfast?: string; lunch?: string; dinner?: string; snack?: string };
type MealStructure = { title: string; days: MealDay[]; notes?: string };
type ShoppingItem = { item: string; quantity?: string; category?: string };
type ShoppingList = { title: string; items: ShoppingItem[] };
type HabitPlan = { title: string; focus_habit: string; minimum_version?: string; tips?: string[] };

function GenerateButton({
  label,
  notes,
  icon,
}: {
  label: string;
  notes?: string;
  icon?: React.ReactNode;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const idemKey = useRef<string | null>(null);

  async function generate() {
    setLoading(true);
    setMessage(null);
    if (!idemKey.current) idemKey.current = crypto.randomUUID();
    try {
      const res = await fetch("/api/ai/weekly-plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Idempotency-Key": idemKey.current,
        },
        body: JSON.stringify({ notes: notes ?? "" }),
      });
      const data = await res.json();
      if (data.blocked) {
        setMessage(data.user_message);
      } else if (res.ok) {
        idemKey.current = null;
        router.refresh();
      } else if (res.status === 402) {
        setMessage(
          data.error === "upgrade_required"
            ? "Weekly reset is part of Premium — see your options on the Billing page."
            : "You've reached this month's weekly plan fair-use limit — it resets next month. Your existing plans stay readable."
        );
      } else {
        setMessage(errorCopy("plan_provider_failure"));
      }
    } catch {
      setMessage(errorCopy("plan_provider_failure"));
    }
    setLoading(false);
  }

  return (
    <div>
      <button
        onClick={generate}
        disabled={loading}
        className="flex items-center justify-center gap-2 rounded-xl bg-[#7C9A92] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#6D8C7D] disabled:opacity-70"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
        {loading ? "Planning your week..." : label}
      </button>
      {message && (
        <p className="mt-2 rounded-xl bg-[#EEF2FF] px-3 py-2 text-xs text-[#1F2937]">{message}</p>
      )}
    </div>
  );
}

export function WeeklyPlanEmpty() {
  return (
    <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
      <h1 className="text-xl font-semibold text-[#1F2937]">
        Start with the week you actually have
      </h1>
      <p className="mx-auto mt-2 max-w-sm text-sm text-[#6B7280]">
        Add anything that will change the plan—busy evenings, meals out or days
        with very little cooking time.
      </p>
      <div className="mt-6 flex justify-center">
        <GenerateButton label="Shape this week" />
      </div>
    </div>
  );
}

function SectionCard({ section }: { section: Section | null }) {
  if (!section?.items?.length) return null;
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="font-medium text-[#1F2937]">{section.title}</h2>
      <ul className="mt-3 space-y-2.5">
        {section.items.map((item, i) => (
          <li key={i} className="flex gap-3">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#7C9A92]" />
            <div>
              <p className="text-sm font-medium text-[#1F2937]">
                {item.title}
                {item.time_hint && (
                  <span className="ml-2 font-normal text-[#9CA3AF]">{item.time_hint}</span>
                )}
              </p>
              {item.description && <p className="text-sm text-[#6B7280]">{item.description}</p>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WeeklyPlanView({ plan }: { plan: WeeklyPlan }) {
  const [copied, setCopied] = useState(false);

  const meals = plan.meal_structure as MealStructure | null;
  const shopping = plan.shopping_list as unknown as ShoppingList | null;
  const habitPlan = plan.habit_plan as unknown as HabitPlan | null;
  const reviewQuestions = (plan.review_questions as unknown as string[]) ?? [];

  const grouped = (shopping?.items ?? []).reduce<Record<string, ShoppingItem[]>>(
    (acc, item) => {
      const cat = item.category?.trim() || "other";
      (acc[cat] ??= []).push(item);
      return acc;
    },
    {}
  );

  async function copyList() {
    const text = Object.entries(grouped)
      .map(
        ([cat, items]) =>
          `${cat.toUpperCase()}\n` +
          items.map((i) => `- ${i.item}${i.quantity ? ` (${i.quantity})` : ""}`).join("\n")
      )
      .join("\n\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-4">
      {/* 1. Weekly focus */}
      <div className="rounded-2xl bg-[#7C9A92] p-6 text-white">
        <p className="text-xs font-medium uppercase tracking-wide text-white/70">
          Week of {plan.week_start}
        </p>
        <h1 className="mt-1 text-lg font-semibold">{plan.weekly_focus}</h1>
        <p className="mt-2 text-sm text-white/85">
          A flexible draft, not a schedule — swap meals, skip days and change
          anything that doesn&rsquo;t fit the week you actually get.
        </p>
      </div>

      {/* 2. Meal structure */}
      {meals && (
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="font-medium text-[#1F2937]">{meals.title}</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[540px] text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-[#9CA3AF]">
                  <th className="pb-2 pr-3 font-medium">Day</th>
                  <th className="pb-2 pr-3 font-medium">Breakfast</th>
                  <th className="pb-2 pr-3 font-medium">Lunch</th>
                  <th className="pb-2 pr-3 font-medium">Dinner</th>
                  <th className="pb-2 font-medium">Snack</th>
                </tr>
              </thead>
              <tbody className="text-[#1F2937]">
                {meals.days.map((d, i) => (
                  <tr key={i} className="border-t border-[#F3F0EA]">
                    <td className="py-2.5 pr-3 font-medium">{d.day}</td>
                    <td className="py-2.5 pr-3">{d.breakfast}</td>
                    <td className="py-2.5 pr-3">{d.lunch}</td>
                    <td className="py-2.5 pr-3">{d.dinner}</td>
                    <td className="py-2.5">{d.snack}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {meals.notes && <p className="mt-3 text-sm text-[#6B7280]">{meals.notes}</p>}
          <p className="mt-3 text-xs text-[#9CA3AF]">
            Meals marked &ldquo;(saved favourite)&rdquo; come from your saved
            meals; &ldquo;(leftovers)&rdquo; reuse an earlier cook. Everything
            is swappable — change any meal before you build the shopping draft.
          </p>
        </div>
      )}

      {/* 3. Shopping list */}
      {shopping && (
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-[#1F2937]">{shopping.title}</h2>
            <button
              onClick={copyList}
              className="flex items-center gap-1.5 rounded-lg border border-[#E5E1DA] px-2.5 py-1.5 text-xs text-[#6B7280] transition hover:border-[#7C9A92]/50 hover:text-[#1F2937]"
            >
              {copied ? <Check className="h-3 w-3 text-[#166534]" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy list"}
            </button>
          </div>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {Object.entries(grouped).map(([cat, items]) => (
              <div key={cat}>
                <p className="text-xs font-medium uppercase tracking-wide text-[#9CA3AF]">{cat}</p>
                <ul className="mt-1.5 space-y-1">
                  {items.map((item, i) => (
                    <li key={i} className="text-sm text-[#1F2937]">
                      {item.item}
                      {item.quantity && (
                        <span className="text-[#9CA3AF]"> — {item.quantity}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-[#9CA3AF]">
            This is a shopping draft — quantities come from the planned meals
            and servings, so check your pantry and adjust amounts before you
            shop. Always check product labels for your allergies.
          </p>
        </div>
      )}

      {/* 4-5. Movement + stress */}
      <SectionCard section={plan.movement_plan as Section | null} />
      <SectionCard section={plan.stress_plan as Section | null} />

      {/* 6. Habit plan */}
      {habitPlan && (
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="font-medium text-[#1F2937]">{habitPlan.title}</h2>
          <p className="mt-1 text-sm text-[#1F2937]">{habitPlan.focus_habit}</p>
          {habitPlan.minimum_version && (
            <p className="mt-1 text-sm text-[#6B7280]">
              Minimum version: {habitPlan.minimum_version}
            </p>
          )}
          {!!habitPlan.tips?.length && (
            <ul className="mt-2 space-y-1">
              {habitPlan.tips.map((tip, i) => (
                <li key={i} className="text-sm text-[#6B7280]">
                  • {tip}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 7. Low-energy backup */}
      <SectionCard section={plan.low_energy_backup_plan as Section | null} />

      {/* 8. Review questions */}
      {reviewQuestions.length > 0 && (
        <div className="rounded-2xl bg-[#EDE9FE]/60 p-5">
          <h2 className="font-medium text-[#1F2937]">End-of-week reflection</h2>
          <ul className="mt-2 space-y-1.5">
            {reviewQuestions.map((q, i) => (
              <li key={i} className="text-sm text-[#1F2937]">
                • {q}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions — review what will be applied, then create next week yourself */}
      <div className="space-y-3">
        <NextWeekReview />
        <div className="flex flex-wrap gap-2">
          <GenerateButton
            label="Make this week simpler"
            notes="Please make this week simpler and lighter than usual — fewer steps, easier meals."
            icon={<Feather className="h-4 w-4" />}
          />
          <GenerateButton
            label="Generate next week"
            icon={<CalendarPlus className="h-4 w-4" />}
          />
        </div>
      </div>
    </div>
  );
}
