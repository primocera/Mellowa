import type { PlanMode, CustomArea } from "@/schemas/ai-output-v2";

/**
 * Mode resolution (Prompt 2):
 *   explicit user selection → custom (or the chosen mode)
 *   very low energy / very little time → minimum
 *   high stress or disrupted day → reset
 *   otherwise → balanced
 */
export function resolvePlanMode(args: {
  requestedMode?: string;
  energy_level: number;
  stress_level: number;
  time_available?: string;
}): PlanMode {
  const { requestedMode, energy_level, stress_level, time_available } = args;
  if (
    requestedMode === "minimum" ||
    requestedMode === "balanced" ||
    requestedMode === "reset" ||
    requestedMode === "custom"
  ) {
    return requestedMode;
  }
  const veryLittleTime = (time_available ?? "").toLowerCase().includes("very little");
  if (energy_level <= 2 || veryLittleTime) return "minimum";
  if (stress_level >= 4) return "reset";
  return "balanced";
}

/** Mode-specific generation instructions appended to the user prompt. */
export function planModeInstruction(
  mode: PlanMode,
  customAreasList: CustomArea[]
): string {
  switch (mode) {
    case "minimum":
      return `PLAN MODE: minimum (set "plan_mode": "minimum").
This is a very low-energy / very little-time day. The whole plan must have NO MORE THAN 4 actionable blocks in total:
- 1 or 2 very easy meal cards (no-cook or under 10 minutes; snack and extra meals omitted),
- hydration with one simple cue,
- ONE 1-3 minute calm reset (breathing_exercise only) OR one very gentle optional movement_moment — not both,
- one short evening_wind_down cue (1-2 steps).
Set meditation_or_reflection, relaxation_technique, focus_block and one_small_habit to null. If you include movement, set breathing_exercise to null and vice versa.`;
    case "reset":
      return `PLAN MODE: reset (set "plan_mode": "reset").
High stress or a disrupted day. Simplify the food structure (2-3 simple meal cards). Include ONE grounding or gentle breathing_exercise. Reduce commitments: set focus_block and meditation_or_reflection to null. Include a short transition ritual as relaxation_technique OR set it to null. Include an EARLY, short evening_wind_down. Optional very gentle movement only if it clearly helps; otherwise null. one_small_habit may be one tiny doable action or null.`;
    case "custom":
      return `PLAN MODE: custom (set "plan_mode": "custom").
The user chose these focus areas: ${customAreasList.length ? customAreasList.join(", ") : "food, calm"}.
Include ONLY blocks for the chosen areas and set everything else to null:
- food → meal_cards (2-4) and hydration (hydration is always required regardless),
- energy → focus_block and, if useful, one restorative pause as relaxation_technique,
- calm → ONE of breathing_exercise / meditation_or_reflection / relaxation_technique,
- movement → movement_moment,
- sleep → evening_wind_down.
Keep meal_cards to at least 1 easy anchor even if food is not chosen. one_small_habit only if it fits a chosen area, else null.`;
    case "balanced":
    default:
      return `PLAN MODE: balanced (set "plan_mode": "balanced").
Normal energy and time. Include: meal_cards (3-4), hydration, ONE movement_moment, exactly ONE calm practice (choose the single most relevant of breathing_exercise / meditation_or_reflection / relaxation_technique and set the other two to null), one focus_block, one evening_wind_down and one tiny one_small_habit.`;
  }
}

/** Counts the actionable blocks a generated plan asks of the user. */
export function countActionableBlocks(plan: {
  meal_cards: unknown[];
  movement_moment?: unknown;
  breathing_exercise?: unknown;
  meditation_or_reflection?: unknown;
  relaxation_technique?: unknown;
  focus_block?: unknown;
  evening_wind_down?: unknown;
  one_small_habit?: unknown;
}): number {
  const optional = [
    plan.movement_moment,
    plan.breathing_exercise,
    plan.meditation_or_reflection,
    plan.relaxation_technique,
    plan.focus_block,
    plan.evening_wind_down,
    plan.one_small_habit,
  ].filter((b) => b != null).length;
  return plan.meal_cards.length + optional;
}
