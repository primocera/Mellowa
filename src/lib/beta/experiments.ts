/**
 * MW-V10-06: only one onboarding experiment may run at a time.
 *
 * Two experiments that both change the purchase decision make neither readable:
 * if yearly emphasis and a longer trial ship together and conversion moves, the
 * cohort sizes here are far too small to attribute the change to either. The
 * rule was written in `docs/experiments/trial-length.md` and enforced by
 * nobody — this makes it checkable, and surfaces the conflict to the owner on
 * the dashboard rather than in a post-mortem.
 *
 * Deliberately advisory, not fail-closed: refusing to boot or silently
 * disabling one arm mid-flight would change what live users see, and could
 * re-time a pinned trial. The owner is told; the owner decides.
 *
 * Pure module — env is passed in, so the conflict table is testable.
 */

export type ExperimentArea = "onboarding" | "daily_loop" | "weekly_loop";

export interface RunningExperiment {
  /** Short slug used in the dashboard and the weekly memo. */
  id: string;
  /** Experiments in the same area compete for the same decision. */
  area: ExperimentArea;
  label: string;
  /** How the owner turns it off — copied verbatim into the dashboard. */
  rollback: string;
}

type EnvLike = Record<string, string | undefined>;

function on(raw: string | undefined): boolean {
  return raw === "1" || raw?.toLowerCase() === "true";
}

/**
 * Which experiments are actually live right now, read from the same env the
 * features read. An experiment that is configured but assigning 0% of users is
 * not running.
 */
export function runningExperiments(env: EnvLike = process.env): RunningExperiment[] {
  const live: RunningExperiment[] = [];

  const trialPercent = Number(env.TRIAL_EXPERIMENT_PERCENT ?? "0");
  if (
    on(env.FLAG_TRIAL_LENGTH_EXPERIMENT) &&
    Number.isFinite(trialPercent) &&
    trialPercent > 0
  ) {
    live.push({
      id: "trial_length",
      area: "onboarding",
      label: "Trial length (3-day vs 7-day)",
      rollback: "FLAG_TRIAL_LENGTH_EXPERIMENT=0",
    });
  }

  if (on(env.FLAG_EMPHASIZE_YEARLY)) {
    live.push({
      id: "yearly_emphasis",
      area: "onboarding",
      label: "Yearly plan emphasis",
      rollback: "unset FLAG_EMPHASIZE_YEARLY",
    });
  }

  return live;
}

export interface ExperimentConflict {
  area: ExperimentArea;
  ids: string[];
  message: string;
}

/**
 * Conflicts are per AREA: two onboarding experiments are unreadable together,
 * but an onboarding experiment and a daily-loop one measure different
 * decisions and may overlap.
 */
export function experimentConflicts(
  running: readonly RunningExperiment[]
): ExperimentConflict[] {
  const byArea = new Map<ExperimentArea, RunningExperiment[]>();
  for (const e of running) {
    byArea.set(e.area, [...(byArea.get(e.area) ?? []), e]);
  }
  const out: ExperimentConflict[] = [];
  for (const [area, list] of byArea) {
    if (list.length > 1) {
      out.push({
        area,
        ids: list.map((e) => e.id).sort(),
        message: `${list.length} ${area} experiments are live at once (${list
          .map((e) => e.label)
          .join(", ")}). Neither result will be attributable — turn one off: ${list
          .map((e) => e.rollback)
          .join(" or ")}.`,
      });
    }
  }
  return out.sort((a, b) => a.area.localeCompare(b.area));
}
