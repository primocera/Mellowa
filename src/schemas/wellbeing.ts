import { z } from "zod";

export const levelScale = z.number().int().min(1).max(5);

export const primaryGoals = [
  "more_energy",
  "better_meal_rhythm",
  "less_overwhelm",
  "better_sleep_routine",
  "habit_consistency",
  "general_wellbeing_structure",
] as const;

export const preferredTones = [
  "gentle",
  "direct",
  "minimal",
  "encouraging",
] as const;

// Bump when the safety/privacy consent wording materially changes so we can
// re-prompt existing users for consent.
export const CONSENT_VERSION = "2026-07-15";

export const scheduleTypes = [
  "office",
  "home",
  "caregiving",
  "shift",
  "travel",
  "irregular",
] as const;

export const mealPatterns = [
  "three_meals",
  "two_meals",
  "small_frequent",
  "flexible",
] as const;

export const kitchenEquipmentOptions = [
  "stovetop",
  "oven",
  "microwave",
  "blender",
  "air_fryer",
  "minimal",
] as const;

/**
 * Input bounds for the wellbeing profile and check-in (server-validated; the DB
 * mirrors them as CHECK constraints). Generous for real answers, but a bound —
 * these values travel into AI prompts and are stored as health-adjacent data.
 */
export const PROFILE_LIMITS = {
  /** wake_time / sleep_time: an <input type="time"> value ("HH:MM[:SS]"). */
  timeChars: 16,
  workScheduleChars: 200,
  /** food_preferences / allergies / disliked_ingredients, per item. */
  listItemChars: 60,
  /** food_preferences / allergies / disliked_ingredients, item count. */
  listMaxItems: 30,
  timezoneChars: 64,
  localeChars: 16,
} as const;

export const CHECKIN_LIMITS = {
  hungerPatternChars: 300,
  timeAvailableChars: 60,
  todayFocusChars: 300,
  notesChars: 2000,
} as const;

/** A bounded free-text list (comma-separated answers split client-side). */
function boundedList(label: string) {
  return z
    .array(
      z
        .string()
        .max(
          PROFILE_LIMITS.listItemChars,
          `Please keep each ${label} under ${PROFILE_LIMITS.listItemChars} characters.`
        )
    )
    .max(
      PROFILE_LIMITS.listMaxItems,
      `Please list at most ${PROFILE_LIMITS.listMaxItems} ${label}s.`
    )
    .default([]);
}

export const WellbeingProfileInput = z.object({
  wake_time: z
    .string()
    .min(1, "Pick a wake time")
    .max(PROFILE_LIMITS.timeChars, "Pick a wake time"),
  sleep_time: z
    .string()
    .min(1, "Pick a sleep time")
    .max(PROFILE_LIMITS.timeChars, "Pick a sleep time"),
  work_schedule: z
    .string()
    .min(1, "Tell us your typical schedule")
    .max(
      PROFILE_LIMITS.workScheduleChars,
      `Please keep your schedule under ${PROFILE_LIMITS.workScheduleChars} characters.`
    ),
  primary_goal: z.enum(primaryGoals),
  food_preferences: boundedList("food preference"),
  allergies: boundedList("allergy"),
  cooking_time: z.enum(["under_15", "15_30", "30_60", "over_60"]),
  budget_level: z.enum(["low", "medium", "flexible"]),
  energy_baseline: levelScale,
  stress_baseline: levelScale,
  sleep_quality_baseline: levelScale,
  movement_level: z.enum(["mostly_sitting", "lightly_active", "active", "very_active"]),
  preferred_tone: z.enum(preferredTones),
  // Preference, kept separate from the allergies safety field.
  disliked_ingredients: boundedList("disliked ingredient"),
  // Locale/time context (auto-detected client-side, optional).
  timezone: z.string().max(PROFILE_LIMITS.timezoneChars).optional().default(""),
  locale: z.string().max(PROFILE_LIMITS.localeChars).optional().default(""),
  safety_acknowledged: z.literal(true, {
    error: "Please confirm you understand what Mellowa is (and isn't).",
  }),
  is_adult: z.literal(true, {
    error: "You must be 18 or older to use Mellowa.",
  }),
});

export type WellbeingProfileInputType = z.infer<typeof WellbeingProfileInput>;

// Advanced plan preferences (Settings). All optional — sensible defaults apply.
export const PlanPreferencesInput = z.object({
  // Explicit opt-in (Prompt 7): nutrition estimates default to hidden.
  show_macros: z.boolean().default(false),
  macro_focus: z.string().optional().default(""),
  preferred_meal_prep_time: z.string().optional().default(""),
  cooking_skill: z.string().optional().default(""),
  movement_preference: z.array(z.string()).default([]),
  movement_limitations: z.string().max(500).optional().default(""),
  stress_reset_preference: z.array(z.string()).default([]),
  meditation_experience: z.string().optional().default(""),
  preferred_routine_length: z.string().optional().default(""),
  schedule_type: z.enum(["", ...scheduleTypes]).optional().default(""),
  meal_pattern: z.enum(["", ...mealPatterns]).optional().default(""),
  disliked_ingredients: z.array(z.string()).default([]),
  kitchen_equipment: z.array(z.enum(kitchenEquipmentOptions)).default([]),
  default_servings: z.number().int().min(1).max(8).default(1),
  reminders_opt_in: z.boolean().default(false),
  reminder_time: z.string().max(5).optional().default(""),
  quiet_hours_start: z.string().max(5).optional().default(""),
  quiet_hours_end: z.string().max(5).optional().default(""),
});

export type PlanPreferencesInputType = z.infer<typeof PlanPreferencesInput>;

export const DailyCheckinInput = z.object({
  energy_level: levelScale,
  // Prompt 3: mood and sleep are optional detail — default to neutral.
  mood_level: levelScale.optional().default(3),
  stress_level: levelScale,
  sleep_quality: levelScale.optional().default(3),
  hunger_pattern: z.string().max(CHECKIN_LIMITS.hungerPatternChars).optional().default(""),
  time_available: z.string().max(CHECKIN_LIMITS.timeAvailableChars).optional().default(""),
  // Prompt 3: day context (never a health condition).
  context: z
    .enum([
      // CE-7 display set
      "busy",
      "low_capacity",
      "out_of_routine",
      "home",
      "on_the_go",
      "social",
      // legacy values kept valid for stored check-ins
      "office",
      "caregiving",
      "shift",
      "travel",
      "irregular",
      "",
    ])
    .optional()
    .default(""),
  // Client-local date + IANA timezone so the plan lands on the user's day.
  local_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  timezone: z.string().max(64).optional().default(""),
  today_focus: z.string().max(CHECKIN_LIMITS.todayFocusChars).optional().default(""),
  notes: z.string().max(CHECKIN_LIMITS.notesChars).optional().default(""),
  // Prompt 2: plan-mode selection. "auto" resolves from energy/stress/time.
  mode: z
    .enum(["auto", "minimum", "balanced", "reset", "custom"])
    .optional()
    .default("auto"),
  custom_areas: z
    .array(z.enum(["food", "energy", "calm", "movement", "sleep"]))
    .max(5)
    .optional()
    .default([]),
});

export type DailyCheckinInputType = z.infer<typeof DailyCheckinInput>;

export const HabitInput = z.object({
  name: z.string().min(1).max(120),
  category: z.string().optional().default(""),
  frequency: z.string().optional().default("daily"),
  minimum_version: z.string().optional().default(""),
});

export type HabitInputType = z.infer<typeof HabitInput>;

export const JournalInput = z.object({
  prompt: z.string().max(500).optional().default(""),
  answer: z.string().min(1).max(5000),
  mood_before: levelScale.optional(),
  mood_after: levelScale.optional(),
});

export type JournalInputType = z.infer<typeof JournalInput>;

export const WeeklyPlanInput = z.object({
  notes: z.string().max(2000).optional().default(""),
});

export type WeeklyPlanInputType = z.infer<typeof WeeklyPlanInput>;
