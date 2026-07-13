import type { WellbeingExerciseType, MovementMomentType } from "@/schemas/ai-output-v2";

/** Static, expandable card for a library exercise (stress reset or movement). */
export function ExerciseCard({
  title,
  meta,
  bestFor,
  steps,
  script,
  modifications,
  caution,
}: {
  title: string;
  meta: string;
  bestFor?: string;
  steps: string[];
  script?: string[];
  modifications?: string[];
  caution?: string;
}) {
  return (
    <details className="group rounded-2xl bg-white p-5 shadow-sm">
      <summary className="cursor-pointer list-none">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-medium text-[#1F2937]">{title}</h3>
            {bestFor && <p className="mt-0.5 text-xs text-[#6B7280]">{bestFor}</p>}
          </div>
          <span className="shrink-0 rounded-full bg-[#7C9A92]/10 px-2.5 py-0.5 text-xs font-medium text-[#6D8C7D]">
            {meta}
          </span>
        </div>
      </summary>

      <ol className="mt-3 space-y-1.5">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-2 text-sm text-[#1F2937]">
            <span className="text-[#9CA3AF]">{i + 1}.</span>
            {step}
          </li>
        ))}
      </ol>

      {script && script.length > 0 && (
        <div className="mt-3 rounded-xl bg-[#EDE9FE]/50 px-4 py-3 text-sm italic text-[#1F2937]">
          {script.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}

      {modifications && modifications.length > 0 && (
        <p className="mt-3 text-xs text-[#6B7280]">
          <span className="font-medium">Make it easier:</span>{" "}
          {modifications.join(" ")}
        </p>
      )}

      {caution && <p className="mt-2 text-xs text-[#9CA3AF]">{caution}</p>}
    </details>
  );
}

export function movementMeta(m: MovementMomentType): string {
  const intensity = m.intensity.replace(/_/g, " ");
  return `${m.duration_minutes} min · ${intensity}`;
}

export function exerciseMeta(e: WellbeingExerciseType): string {
  return `${e.duration_minutes} min`;
}
