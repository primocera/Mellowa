import type { Metadata } from "next";
import { MOVEMENT_LIBRARY } from "@/lib/library/movement";
import {
  ExerciseCard,
  movementMeta,
} from "@/components/dailyflow/exercise-card";

export const metadata: Metadata = { title: "Movement — Mellowa" };

export default function MovementPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[#1F2937]">
          Choose what fits your body today
        </h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          Short, general movement ideas — always optional. Stop if anything
          causes pain, dizziness or unusual discomfort.
        </p>
      </div>

      <div className="space-y-2">
        {MOVEMENT_LIBRARY.map((m) => (
          <ExerciseCard
            key={m.title}
            title={m.title}
            meta={movementMeta(m)}
            bestFor={m.best_time}
            steps={m.steps}
            modifications={m.modifications}
            caution={m.caution_note}
          />
        ))}
      </div>

      <p className="px-2 text-xs text-[#9CA3AF]">
        Skip any movement that causes pain. If you have an injury, are pregnant,
        or have a medical condition, please check with a qualified professional
        before starting.
      </p>
    </div>
  );
}
