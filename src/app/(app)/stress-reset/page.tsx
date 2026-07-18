import type { Metadata } from "next";
import { STRESS_RESET_LIBRARY } from "@/lib/library/stress-reset";
import {
  ExerciseCard,
  exerciseMeta,
} from "@/components/dailyflow/exercise-card";

export const metadata: Metadata = { title: "Resets — Mellowa" };

const CATEGORIES = [
  { key: "breathing", label: "Breathing" },
  { key: "meditation", label: "Meditation & reflection" },
  { key: "relaxation", label: "Relaxation" },
] as const;

export default function StressResetPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[#1F2937]">
          Resets
        </h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          Brief practices for everyday tension or overload. Pick whatever fits
          the moment.
        </p>
      </div>

      {CATEGORIES.map((cat) => {
        const items = STRESS_RESET_LIBRARY.filter((e) => e.category === cat.key);
        return (
          <section key={cat.key}>
            <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-[#9CA3AF]">
              {cat.label}
            </h2>
            <div className="space-y-2">
              {items.map((e) => (
                <ExerciseCard
                  key={e.title}
                  title={e.title}
                  meta={exerciseMeta(e)}
                  bestFor={e.best_for}
                  steps={e.steps}
                  script={e.short_script}
                  caution={e.caution_note}
                />
              ))}
            </div>
          </section>
        );
      })}

      <p className="px-2 text-xs text-[#9CA3AF]">
        These are general wellbeing tools, not treatment for anxiety, panic,
        depression or trauma. If you feel unsafe or in crisis, please reach out
        to a qualified professional or local emergency services.
      </p>
    </div>
  );
}
