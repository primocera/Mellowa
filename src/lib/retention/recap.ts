import { isVerdict, type Verdict } from "@/lib/feedback/learned";

/**
 * Neutral weekly recap (Launch v6, Prompt 22).
 *
 * Retention here is honest reflection, never pressure: we report how many
 * plans were created and the themes in the user's own feedback. We never
 * compute adherence ("you completed X of Y"), streaks, mood change or any
 * health-outcome claim — those are out of scope for the product and banned in
 * copy. Pure and deterministic so it is fully unit-testable.
 */

export type RecapTheme = { key: Verdict; label: string; count: number };

export interface WeeklyRecap {
  plansCreated: number;
  /** Themes from explicit feedback, most frequent first. Empty is fine. */
  themes: RecapTheme[];
  /** A calm one-line summary; never an evaluation of the person. */
  headline: string;
}

// Neutral, plain phrasing for each verdict — describes the plan's fit, not the
// user's behaviour. "helpful" is framed as fit, not achievement.
const THEME_LABELS: Record<Verdict, string> = {
  helpful: "Plans that fit your day",
  not_for_me: "Days the approach wasn't right",
  too_much: "Days that felt like too much",
  too_little_time: "Days you needed something quicker",
  didnt_fit_food: "Days the food didn't fit",
};

function withinLastWeek(iso: string, now: Date): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  return t >= weekAgo && t <= now.getTime();
}

export function summarizeWeek(
  plans: { created_at: string }[],
  feedback: { verdict: string; created_at: string }[],
  now: Date = new Date()
): WeeklyRecap {
  const plansCreated = plans.filter((p) => withinLastWeek(p.created_at, now)).length;

  const counts = new Map<Verdict, number>();
  for (const f of feedback) {
    if (!withinLastWeek(f.created_at, now)) continue;
    if (!isVerdict(f.verdict)) continue;
    counts.set(f.verdict as Verdict, (counts.get(f.verdict as Verdict) ?? 0) + 1);
  }
  const themes: RecapTheme[] = [...counts.entries()]
    .map(([key, count]) => ({ key, label: THEME_LABELS[key], count }))
    .sort((a, b) => b.count - a.count);

  const headline =
    plansCreated === 0
      ? "No plans yet this week — whenever you're ready, a check-in is a minute."
      : plansCreated === 1
        ? "You created one plan this week."
        : `You created ${plansCreated} plans this week.`;

  return { plansCreated, themes, headline };
}
