import { z } from "zod";
import {
  MealCardSchema,
  MovementMomentSchema,
  PlanSectionSchemas,
  type MealCardType,
} from "@/schemas/ai-output-v2";

/**
 * MW-S02: atomic remaining-day repair — pure helpers.
 *
 * A repair replaces ONLY the sections that are still open (not completed and
 * not explicitly kept), in one AI response validated as a whole and committed
 * in one database transaction (apply_plan_repair RPC, migration 027).
 * Completed and locked items are carried over byte-for-byte from the stored
 * plan; the AI never sees them as replacement targets.
 */

export const REPAIR_REASONS = [
  "less_time",
  "lower_energy",
  "context_changed",
  "meal_not_working",
  "calmer_version",
] as const;
export type RepairReason = (typeof REPAIR_REASONS)[number];

export const REPAIR_REASON_INSTRUCTIONS: Record<RepairReason, string> = {
  less_time:
    "The user now has less time than planned. Make every remaining item shorter and easier.",
  lower_energy:
    "The user's energy is lower than expected. Make the remaining day gentler and smaller.",
  context_changed:
    "The user's practical context changed (location, schedule or company). Adapt remaining items to be flexible and low-setup.",
  meal_not_working:
    "The planned meals no longer work. Replace remaining meals with different, similar-effort options.",
  calmer_version:
    "The user wants a calmer version of the rest of the day. Reduce load and favour the calm reset.",
};

/** Completion/lock keys ↔ plan columns the repair may touch. */
const SECTION_BY_KEY = {
  movement: "movement_plan",
  breathing: "breathing_exercise",
  meditation: "meditation_or_reflection",
  relaxation: "relaxation_technique",
  focus: "focus_plan",
  evening: "evening_routine",
  habit: "habit_focus",
} as const;

type SectionColumn = (typeof SECTION_BY_KEY)[keyof typeof SECTION_BY_KEY] | "meal_cards";

export interface RepairPlanRow {
  meal_cards?: MealCardType[] | null;
  movement_plan?: unknown;
  breathing_exercise?: unknown;
  meditation_or_reflection?: unknown;
  relaxation_technique?: unknown;
  focus_plan?: unknown;
  evening_routine?: unknown;
  habit_focus?: unknown;
}

export interface RepairScope {
  /** Meal types still open for replacement (order preserved). */
  mealTypes: string[];
  /** Non-meal plan columns still open for replacement. */
  sections: Exclude<SectionColumn, "meal_cards">[];
  /** Item keys that are protected (completed or explicitly kept). */
  protectedKeys: string[];
}

/**
 * Which parts of the plan a repair may replace, given completed + kept keys.
 * Anything protected — or absent from the plan — is out of scope.
 */
export function replaceableScope(
  plan: RepairPlanRow,
  completedKeys: readonly string[],
  keepKeys: readonly string[] = []
): RepairScope {
  const isProtected = new Set([...completedKeys, ...keepKeys]);
  const mealTypes = (plan.meal_cards ?? [])
    .filter((m) => !isProtected.has(`meal:${m.meal_type}`))
    .map((m) => m.meal_type);
  const sections: Exclude<SectionColumn, "meal_cards">[] = [];
  for (const [key, column] of Object.entries(SECTION_BY_KEY)) {
    if (plan[column as keyof RepairPlanRow] && !isProtected.has(key)) {
      sections.push(column as Exclude<SectionColumn, "meal_cards">);
    }
  }
  return { mealTypes, sections, protectedKeys: [...isProtected] };
}

const HabitSchema = z.object({
  habit: z.string(),
  minimum_version: z.string(),
  tracking_question: z.string().default(""),
});
const MeditationSchema = z.object({
  name: z.string(),
  duration_minutes: z.number().min(1).max(30),
  script: z.array(z.string()).min(1),
  journal_prompt: z.string().default(""),
});
const FocusSchema = z.object({
  main_task: z.string(),
  method: z.string().default(""),
  break_reminder: z.string().default(""),
});

const SECTION_SCHEMAS: Record<Exclude<SectionColumn, "meal_cards">, z.ZodTypeAny> = {
  movement_plan: MovementMomentSchema,
  breathing_exercise: PlanSectionSchemas.breathing_exercise,
  meditation_or_reflection: MeditationSchema,
  relaxation_technique: PlanSectionSchemas.relaxation_technique,
  focus_plan: FocusSchema,
  evening_routine: PlanSectionSchemas.evening_wind_down,
  habit_focus: HabitSchema,
};

/**
 * Strict schema for the single AI repair response: repair_summary plus exactly
 * the in-scope sections — extra keys or a missing section fail validation, so
 * a partial or over-eager response can never be committed.
 */
export function repairOutputSchema(scope: RepairScope) {
  const shape: Record<string, z.ZodTypeAny> = {
    repair_summary: z.string().min(1).max(400),
  };
  if (scope.mealTypes.length) {
    shape.meal_cards = z
      .array(MealCardSchema)
      .length(scope.mealTypes.length)
      .refine(
        (cards) =>
          scope.mealTypes.every((t) => cards.some((c) => c.meal_type === t)) &&
          cards.every((c) => scope.mealTypes.includes(c.meal_type)),
        { message: "meal_cards must cover exactly the requested meal types" }
      );
  }
  for (const section of scope.sections) {
    shape[section] = SECTION_SCHEMAS[section];
  }
  return z.object(shape).strict();
}

/**
 * MW-V9-04: deterministic diff line derived from the categorical changed
 * types that the server computed from stored versions — never from the
 * model-written repair_summary. Same input always yields the same sentence.
 */
const CHANGED_TYPE_LABELS: Record<string, string> = {
  meals: "meals",
  movement: "movement",
  calm: "the calm reset",
  focus: "the focus block",
  evening: "the evening wind-down",
  habit: "the habit",
};

export function deterministicDiff(changedTypes: readonly string[]): string {
  const labels = changedTypes
    .map((t) => CHANGED_TYPE_LABELS[t])
    .filter((l): l is string => !!l);
  if (!labels.length) return "Nothing was changed.";
  const list =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `Changed: ${list}.`;
}

/**
 * MW-V18-10: reshape transparency. Given the repair scope, the server-computed
 * changed types and the trigger reason, describe WHAT STAYS, WHAT CHANGES and
 * WHY — so the user sees that completed/kept work is preserved and only the
 * remaining day was reshaped. Derived from server facts (scope + changedTypes),
 * never from the model's prose, so it is deterministic.
 */
export const REPAIR_REASON_LABELS: Record<RepairReason, string> = {
  less_time: "you have less time",
  lower_energy: "your energy is lower",
  context_changed: "your context changed",
  meal_not_working: "the meals weren't working",
  calmer_version: "you wanted a calmer rest of day",
};

const PROTECTED_KEY_LABELS: Record<string, string> = {
  movement: "movement",
  breathing: "the calm reset",
  meditation: "the reflection",
  relaxation: "the relaxation",
  focus: "the focus block",
  evening: "the evening wind-down",
  habit: "the habit",
};

function labelProtectedKey(key: string): string {
  if (key.startsWith("meal:")) return `the ${key.slice(5)}`;
  return PROTECTED_KEY_LABELS[key] ?? key;
}

export interface RepairChangeSummary {
  /** Plain-language trigger, e.g. "your energy is lower". */
  trigger: string;
  /** Human labels of what was reshaped (from server changedTypes). */
  changes: string[];
  /** Human labels of what was preserved (completed or explicitly kept). */
  stays: string[];
  /** One honest sentence combining the above. */
  summary: string;
}

export function repairChangeSummary(
  scope: RepairScope,
  changedTypes: readonly string[],
  reason: RepairReason
): RepairChangeSummary {
  const changes = changedTypes
    .map((t) => CHANGED_TYPE_LABELS[t])
    .filter((l): l is string => !!l);
  const stays = scope.protectedKeys.map(labelProtectedKey);
  const trigger = REPAIR_REASON_LABELS[reason];

  const changeText =
    changes.length === 0
      ? "nothing in the rest of your day needed to change"
      : `only the rest of your day changed (${joinList(changes)})`;
  const stayText = stays.length ? ` What you already did stays (${joinList(stays)}).` : "";
  return {
    trigger,
    changes,
    stays,
    summary: `Because ${trigger}, ${changeText}.${stayText}`,
  };
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export interface RepairUpdates {
  /** Column → new value, ready for the atomic apply_plan_repair RPC. */
  updates: Record<string, unknown>;
  /** Categorical changed-section types for analytics (never content). */
  changedTypes: string[];
}

/**
 * Merge the validated AI response into column updates. Protected meals are the
 * ORIGINAL objects (reference-identical → byte-identical when serialized);
 * only in-scope entries are swapped. Non-meal sections are whole-column
 * replacements that were already confirmed in scope.
 */
export function buildRepairUpdates(
  plan: RepairPlanRow,
  scope: RepairScope,
  aiResponse: Record<string, unknown>
): RepairUpdates {
  const updates: Record<string, unknown> = {};
  const changedTypes: string[] = [];
  const newMeals = aiResponse.meal_cards as MealCardType[] | undefined;
  if (newMeals && scope.mealTypes.length) {
    updates.meal_cards = (plan.meal_cards ?? []).map((original) =>
      scope.mealTypes.includes(original.meal_type)
        ? newMeals.find((m) => m.meal_type === original.meal_type) ?? original
        : original
    );
    changedTypes.push("meals");
  }
  const typeLabel: Record<string, string> = {
    movement_plan: "movement",
    breathing_exercise: "calm",
    meditation_or_reflection: "calm",
    relaxation_technique: "calm",
    focus_plan: "focus",
    evening_routine: "evening",
    habit_focus: "habit",
  };
  for (const section of scope.sections) {
    if (aiResponse[section] !== undefined) {
      updates[section] = aiResponse[section];
      const label = typeLabel[section];
      if (label && !changedTypes.includes(label)) changedTypes.push(label);
    }
  }
  return { updates, changedTypes };
}
