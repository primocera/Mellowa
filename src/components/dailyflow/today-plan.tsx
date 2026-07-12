"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Check, Feather } from "lucide-react";
import type { DailyPlan } from "@/types/dailyflow";
import clsx from "clsx";

type PlanItem = { title: string; description?: string; time_hint?: string };
type Section = { title: string; items: PlanItem[] };
type HabitFocus = { title: string; habit: string; minimum_version?: string };
type Summary = { title: string; summary: string };

const REGENERATABLE = [
  "meal_rhythm",
  "movement_plan",
  "stress_reset",
  "evening_routine",
] as const;

type RegenSection = (typeof REGENERATABLE)[number];

const REGEN_LABELS: Record<RegenSection, string> = {
  meal_rhythm: "Change meals",
  movement_plan: "Make it gentler",
  stress_reset: "Try another reset",
  evening_routine: "Make it shorter",
};

const REGEN_REASONS: Record<RegenSection, string> = {
  meal_rhythm: "different_meals",
  movement_plan: "lower_energy",
  stress_reset: "simplify",
  evening_routine: "less_time",
};

function SectionCard({
  section,
  planId,
  sectionKey,
  onUpdated,
}: {
  section: Section | null;
  planId: string;
  sectionKey?: RegenSection;
  onUpdated?: (s: Section) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!section) return null;

  async function regenerate(reason: string) {
    if (!sectionKey) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/ai/regenerate-section", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_id: planId,
          section_name: sectionKey,
          reason,
        }),
      });
      const data = await res.json();
      if (data.blocked) {
        setMessage(data.user_message);
      } else if (res.ok && data.section) {
        onUpdated?.(data.section);
      } else {
        setMessage("Couldn't update this section right now — try again in a moment.");
      }
    } catch {
      setMessage("Couldn't update this section right now — try again in a moment.");
    }
    setBusy(false);
  }

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium text-[#1F2937]">{section.title}</h2>
        {sectionKey && (
          <div className="flex gap-1.5">
            <button
              onClick={() => regenerate(REGEN_REASONS[sectionKey])}
              disabled={busy}
              title={REGEN_LABELS[sectionKey]}
              className="flex items-center gap-1 rounded-lg border border-[#E5E1DA] px-2.5 py-1.5 text-xs text-[#6B7280] transition hover:border-[#7C9A92]/50 hover:text-[#1F2937] disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {REGEN_LABELS[sectionKey]}
            </button>
          </div>
        )}
      </div>
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
              {item.description && (
                <p className="text-sm text-[#6B7280]">{item.description}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
      {message && (
        <p className="mt-3 rounded-xl bg-[#EEF2FF] px-3 py-2 text-xs text-[#1F2937]">{message}</p>
      )}
    </div>
  );
}

export function TodayPlan({ plan }: { plan: DailyPlan }) {
  const router = useRouter();
  const [sections, setSections] = useState<Record<string, Section | null>>({
    morning_routine: plan.morning_routine as Section | null,
    meal_rhythm: plan.meal_rhythm as Section | null,
    hydration_plan: plan.hydration_plan as Section | null,
    movement_plan: plan.movement_plan as Section | null,
    stress_reset: plan.stress_reset as Section | null,
    focus_plan: plan.focus_plan as Section | null,
    evening_routine: plan.evening_routine as Section | null,
  });
  const [habitDone, setHabitDone] = useState(false);
  const [simplifying, setSimplifying] = useState(false);

  const summary = plan.plan_summary as Summary | null;
  const habitFocus = plan.habit_focus as HabitFocus | null;

  const setSection = (key: string) => (s: Section) =>
    setSections((prev) => ({ ...prev, [key]: s }));

  async function simplifyAll() {
    setSimplifying(true);
    // Simplify the heavier sections one by one
    for (const key of REGENERATABLE) {
      try {
        const res = await fetch("/api/ai/regenerate-section", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan_id: plan.id,
            section_name: key,
            reason: "simplify",
          }),
        });
        const data = await res.json();
        if (res.ok && data.section) setSection(key)(data.section);
      } catch {
        // keep the original section if one call fails
      }
    }
    setSimplifying(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* 1. Summary */}
      {summary && (
        <div className="rounded-2xl bg-[#7C9A92] p-6 text-white">
          <h1 className="text-lg font-semibold">{summary.title}</h1>
          <p className="mt-1 text-sm text-white/90">{summary.summary}</p>
        </div>
      )}

      <SectionCard section={sections.morning_routine} planId={plan.id} />
      <SectionCard
        section={sections.meal_rhythm}
        planId={plan.id}
        sectionKey="meal_rhythm"
        onUpdated={setSection("meal_rhythm")}
      />
      <SectionCard section={sections.hydration_plan} planId={plan.id} />
      <SectionCard
        section={sections.movement_plan}
        planId={plan.id}
        sectionKey="movement_plan"
        onUpdated={setSection("movement_plan")}
      />
      <SectionCard
        section={sections.stress_reset}
        planId={plan.id}
        sectionKey="stress_reset"
        onUpdated={setSection("stress_reset")}
      />
      <SectionCard section={sections.focus_plan} planId={plan.id} />
      <SectionCard
        section={sections.evening_routine}
        planId={plan.id}
        sectionKey="evening_routine"
        onUpdated={setSection("evening_routine")}
      />

      {/* 9. One small habit */}
      {habitFocus && (
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="font-medium text-[#1F2937]">{habitFocus.title}</h2>
          <p className="mt-1 text-sm text-[#1F2937]">{habitFocus.habit}</p>
          {habitFocus.minimum_version && (
            <p className="mt-1 text-sm text-[#6B7280]">
              Minimum version: {habitFocus.minimum_version}
            </p>
          )}
          <button
            onClick={() => setHabitDone((d) => !d)}
            className={clsx(
              "mt-3 flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition",
              habitDone
                ? "bg-[#DCFCE7] text-[#166534]"
                : "bg-[#7C9A92] text-white hover:bg-[#6D8C7D]"
            )}
          >
            <Check className="h-4 w-4" />
            {habitDone ? "Done today" : "Mark as done"}
          </button>
        </div>
      )}

      {/* 10. Encouragement */}
      {plan.encouragement && (
        <div className="rounded-2xl bg-[#EDE9FE]/60 p-5 text-sm text-[#1F2937]">
          {plan.encouragement}
        </div>
      )}

      {plan.safety_note && (
        <p className="px-2 text-xs text-[#9CA3AF]">{plan.safety_note}</p>
      )}

      {/* This feels too much */}
      <button
        onClick={simplifyAll}
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
