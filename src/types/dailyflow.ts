// Hand-maintained row types. These are the app's canonical DB shapes and are
// kept in sync with supabase/migrations/* by hand; per-query row shapes in
// billing/analytics code intentionally narrow to just the columns they read.
//
// OWNED ISSUE (owner-run, not a floating TODO): replace this file with generated
// types once the CLI can reach the deployed schema.
//   Command:     supabase gen types typescript --project-id <ref> > src/types/db.ts
//   Blocked on:  owner Supabase access (SUPABASE_ACCESS_TOKEN + project ref);
//                cannot run from CI without those secrets.
//   Acceptance:  db.ts is generated from the live schema; this file re-exports
//                the generated Row types (no shape drift), typecheck passes, and
//                the Subscription type includes every column migrations added
//                (e.g. `currency` from 042, trial_* fields). Tracked for MW-09/
//                launch follow-up rather than blocking the beta.

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface WellbeingProfile {
  id: string;
  user_id: string;
  age_range: string | null;
  primary_goal: string | null;
  wake_time: string | null;
  sleep_time: string | null;
  work_schedule: string | null;
  food_preferences: string[];
  allergies: string[];
  cooking_time: string | null;
  budget_level: string | null;
  movement_level: string | null;
  sleep_quality_baseline: string | null;
  stress_baseline: string | null;
  supplement_use: string | null;
  preferred_tone: string | null;
  safety_acknowledged: boolean;
  // v2 plan preferences
  show_macros: boolean;
  macro_focus: string | null;
  preferred_meal_prep_time: string | null;
  cooking_skill: string | null;
  movement_preference: string[];
  movement_limitations: string | null;
  stress_reset_preference: string[];
  meditation_experience: string | null;
  preferred_routine_length: string | null;
  // v4 onboarding & preferences (Prompt 4)
  is_adult: boolean;
  timezone: string | null;
  locale: string | null;
  schedule_type: string | null;
  meal_pattern: string | null;
  disliked_ingredients: string[];
  kitchen_equipment: string[];
  default_servings: number;
  reminders_opt_in: boolean;
  reminder_time: string | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  // v8 MW-S05: meal continuity (migration 030).
  meal_reuse_favourites?: boolean;
  meal_repeat_leftovers?: boolean;
  meal_variety_level?: string | null;
  pantry_items?: string[];
  // v8 MW-S07/S08 (migrations 032/033).
  sample_adjustment_used_at?: string | null;
  reminders_paused?: boolean;
  reminder_skip_date?: string | null;
  reminder_consent_version?: string | null;
  // MW-V12-04 (migration 040): when the user last unsubscribed via email link.
  reminders_unsubscribed_at?: string | null;
  consent_version: string | null;
  consent_accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DailyCheckin {
  id: string;
  user_id: string;
  checkin_date: string;
  energy_level: number | null;
  mood_level: number | null;
  stress_level: number | null;
  sleep_quality: number | null;
  hunger_pattern: string | null;
  time_available: string | null;
  today_focus: string | null;
  notes: string | null;
  safety_flag: boolean;
  created_at: string;
}

/** jsonb plan sections — concrete shapes live in src/schemas/ai-output.ts */
export type PlanSection = Record<string, unknown>;

export interface DailyPlan {
  id: string;
  user_id: string;
  checkin_id: string | null;
  plan_date: string;
  plan_summary: PlanSection | null;
  morning_routine: PlanSection | null;
  meal_rhythm: PlanSection | null;
  hydration_plan: PlanSection | null;
  movement_plan: PlanSection | null;
  stress_reset: PlanSection | null;
  focus_plan: PlanSection | null;
  evening_routine: PlanSection | null;
  habit_focus: PlanSection | null;
  encouragement: string | null;
  safety_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface WeeklyPlan {
  id: string;
  user_id: string;
  week_start: string;
  weekly_focus: string | null;
  meal_structure: PlanSection | null;
  shopping_list: PlanSection | null;
  movement_plan: PlanSection | null;
  stress_plan: PlanSection | null;
  habit_plan: PlanSection | null;
  low_energy_backup_plan: PlanSection | null;
  review_questions: PlanSection | null;
  created_at: string;
  updated_at: string;
}

export interface Habit {
  id: string;
  user_id: string;
  name: string;
  category: string | null;
  frequency: string | null;
  minimum_version: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface HabitLog {
  id: string;
  user_id: string;
  habit_id: string;
  log_date: string;
  completed: boolean;
  notes: string | null;
  created_at: string;
}

export interface JournalEntry {
  id: string;
  user_id: string;
  entry_date: string;
  prompt: string | null;
  answer: string | null;
  mood_before: number | null;
  mood_after: number | null;
  created_at: string;
}

export interface SafetyEvent {
  id: string;
  user_id: string;
  source: string | null;
  risk_type: string | null;
  risk_level: string | null;
  user_input_excerpt: string | null;
  action_taken: string | null;
  created_at: string;
}

export interface Subscription {
  id: string;
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan_name: string | null;
  status: string | null;
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
}
