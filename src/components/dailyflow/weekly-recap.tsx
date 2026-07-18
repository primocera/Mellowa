import type { WeeklyRecap } from "@/lib/retention/recap";

/**
 * Neutral weekly recap card (Launch v6, Prompt 22). Shows plans created and
 * feedback themes only — never adherence, streaks, mood change or outcomes.
 * Purely reflective; there is no goal to hit and nothing to keep up.
 */
export function WeeklyRecapCard({ recap }: { recap: WeeklyRecap }) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm" aria-label="Your week">
      <h2 className="text-sm font-medium text-[#1F2937]">Your week</h2>
      <p className="mt-1 text-sm text-[#6B7280]">{recap.headline}</p>
      {recap.themes.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {recap.themes.map((t) => (
            <li key={t.key} className="flex items-center justify-between text-sm">
              <span className="text-[#374151]">{t.label}</span>
              <span className="text-[#9CA3AF]">
                {t.count} {t.count === 1 ? "day" : "days"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-[#9CA3AF]">
        A reflection, not a scorecard — there&rsquo;s nothing to keep up.
      </p>
    </section>
  );
}
