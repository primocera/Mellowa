// MW-S01: deterministic "Now" selector. Picks ONE next useful action from the
// saved plan. Pure module — no AI, no network, no Date.now() — so every rule
// is unit-testable and the same inputs always produce the same action.
//
// Selection rules (documented contract):
// 1. Candidates come only from items that exist on the saved plan; nothing is
//    invented and the plan JSON is never reordered or mutated.
// 2. The local time of day maps to a broad phase (morning / midday / later /
//    evening) — never an exact invented time. Each phase has a fixed priority
//    order over item keys.
// 3. Lighter modes (minimum / reset) rank the calm reset ahead of movement and
//    never surface the focus block.
// 4. Completed items are skipped. Deferred ("Not now") items are skipped for
//    the rest of the session unless nothing else remains, in which case the
//    view shows a neutral summary instead of pressuring a deferred item.
// 5. Item keys are the same stable keys used by plan_completions
//    ("meal:<type>", "movement", "breathing", "meditation", "relaxation",
//    "habit", "evening", "focus") so Done state is shared with the full plan.

import { isLighterDay, pickCalmReset } from "@/lib/today/disclosure";

/**
 * Version of the deterministic selection rules (MW-V9-03). Bump this whenever
 * the phase windows (phaseForMinutes), the per-phase priority order
 * (PHASE_ORDER) or the lighter-day reordering change, so behaviour, tests and
 * any analysis can pin the exact ruleset that produced a selection. The rules
 * themselves are documented in the file header above.
 */
export const NOW_SELECTOR_VERSION = "v9-1";

export type DayPhase = "morning" | "midday" | "later" | "evening";

export type NowItemType =
  | "meal"
  | "movement"
  | "calm_reset"
  | "habit"
  | "evening"
  | "focus";

export interface NowItem {
  /** Stable completion key, e.g. "meal:breakfast" or "movement". */
  key: string;
  type: NowItemType;
  title: string;
  /** Estimated minutes when the stored plan provides one; never invented. */
  durationMinutes?: number;
  /** Short, neutral "why it fits" line. */
  reason: string;
}

export interface NowSelection {
  action: NowItem | null;
  phase: DayPhase;
  /** Items neither completed nor deferred (includes the selected action). */
  remaining: number;
  /** Deferred-but-not-completed items still on the plan. */
  deferred: number;
  /** True when every candidate on the plan is marked done. */
  allDone: boolean;
}

/** Minimal plan shape the selector reads — a subset of the daily_plans row. */
export interface NowPlanInput {
  plan_mode?: string | null;
  plan_intensity?: string | null;
  meal_cards?:
    | { meal_type: string; title: string; total_time_minutes?: number }[]
    | null;
  movement_plan?: { title: string; duration_minutes?: number } | null;
  breathing_exercise?: { name?: string; duration_minutes?: number } | null;
  meditation_or_reflection?: { name?: string; duration_minutes?: number } | null;
  relaxation_technique?: { name?: string; duration_minutes?: number } | null;
  focus_plan?: { main_task: string } | null;
  evening_routine?: { steps?: string[] } | null;
  habit_focus?: { habit: string } | null;
}

/** Broad phase from minutes-since-local-midnight. Boundaries are inclusive-low. */
export function phaseForMinutes(minutes: number): DayPhase {
  const m = ((minutes % 1440) + 1440) % 1440;
  if (m < 11 * 60) return "morning";
  if (m < 15 * 60) return "midday";
  if (m < 18 * 60) return "later";
  return "evening";
}

const MEAL_REASON: Record<DayPhase, string> = {
  morning: "A first food anchor for the day.",
  midday: "A midday food anchor.",
  later: "Something small so the evening starts easier.",
  evening: "An evening food anchor.",
};

function buildCandidates(plan: NowPlanInput): NowItem[] {
  const items: NowItem[] = [];
  for (const meal of plan.meal_cards ?? []) {
    items.push({
      key: `meal:${meal.meal_type}`,
      type: "meal",
      title: meal.title,
      durationMinutes: meal.total_time_minutes,
      reason: "From today's meal rhythm.",
    });
  }
  if (plan.movement_plan) {
    items.push({
      key: "movement",
      type: "movement",
      title: plan.movement_plan.title,
      durationMinutes: plan.movement_plan.duration_minutes,
      reason: "Optional movement, only if it feels useful.",
    });
  }
  const calm = pickCalmReset({
    breathing: plan.breathing_exercise,
    meditation: plan.meditation_or_reflection,
    relaxation: plan.relaxation_technique,
  });
  if (calm) {
    const source =
      calm === "breathing"
        ? plan.breathing_exercise
        : calm === "meditation"
          ? plan.meditation_or_reflection
          : plan.relaxation_technique;
    items.push({
      key: calm,
      type: "calm_reset",
      title: source?.name?.trim() || "A short calm pause",
      durationMinutes: source?.duration_minutes,
      reason: "One pause counts as a real part of the day.",
    });
  }
  if (plan.habit_focus?.habit) {
    items.push({
      key: "habit",
      type: "habit",
      title: plan.habit_focus.habit,
      reason: "One small repeatable step.",
    });
  }
  const mode = plan.plan_mode ?? plan.plan_intensity ?? "balanced";
  if (plan.focus_plan?.main_task && !isLighterDay(mode)) {
    items.push({
      key: "focus",
      type: "focus",
      title: plan.focus_plan.main_task,
      reason: "The one thing worth protecting today.",
    });
  }
  if (plan.evening_routine?.steps?.length) {
    items.push({
      key: "evening",
      type: "evening",
      title: "Evening wind-down",
      reason: "A softer landing for the end of the day.",
    });
  }
  return items;
}

/**
 * Fixed priority order of item KEYS per phase. Meals are referenced by the
 * conventional meal types; unknown meal types keep plan order and slot where
 * "meal:*" appears.
 */
const PHASE_ORDER: Record<DayPhase, string[]> = {
  morning: ["meal:breakfast", "habit", "movement", "calm", "focus", "meal:*", "evening"],
  midday: ["meal:lunch", "focus", "movement", "calm", "habit", "meal:*", "evening"],
  later: ["meal:snack", "calm", "movement", "habit", "focus", "meal:*", "evening"],
  evening: ["meal:dinner", "evening", "calm", "habit", "movement", "meal:*", "focus"],
};

const CALM_KEYS = new Set(["breathing", "meditation", "relaxation"]);

function orderedForPhase(
  candidates: NowItem[],
  phase: DayPhase,
  lighter: boolean
): NowItem[] {
  let order = [...PHASE_ORDER[phase]];
  if (lighter) {
    // Calm before movement on lighter days; focus is already excluded.
    const calmIdx = order.indexOf("calm");
    const moveIdx = order.indexOf("movement");
    if (calmIdx > moveIdx && moveIdx >= 0) {
      order = order.filter((k) => k !== "calm");
      order.splice(order.indexOf("movement"), 0, "calm");
    }
  }
  const rank = (item: NowItem): number => {
    const slot = (k: string) => order.indexOf(k);
    if (CALM_KEYS.has(item.key)) return slot("calm");
    const exact = slot(item.key);
    if (exact >= 0) return exact;
    if (item.key.startsWith("meal:")) return slot("meal:*");
    return order.length;
  };
  // Stable sort: equal ranks keep plan order (e.g. unknown meal types).
  return candidates
    .map((item, i) => ({ item, i }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.i - b.i)
    .map((x) => x.item);
}

export function nextAction(
  plan: NowPlanInput,
  completedKeys: readonly string[],
  localMinutes: number,
  deferredKeys: readonly string[] = []
): NowSelection {
  const phase = phaseForMinutes(localMinutes);
  const candidates = buildCandidates(plan);
  const done = new Set(completedKeys);
  const deferred = new Set(deferredKeys);
  const open = candidates.filter((c) => !done.has(c.key));
  const eligible = open.filter((c) => !deferred.has(c.key));
  const mode = plan.plan_mode ?? plan.plan_intensity ?? "balanced";
  const ordered = orderedForPhase(eligible, phase, isLighterDay(mode));
  const first = ordered[0] ?? null;
  const action = first
    ? { ...first, reason: first.type === "meal" ? MEAL_REASON[phase] : first.reason }
    : null;
  return {
    action,
    phase,
    remaining: eligible.length,
    deferred: open.length - eligible.length,
    allDone: candidates.length > 0 && open.length === 0,
  };
}
