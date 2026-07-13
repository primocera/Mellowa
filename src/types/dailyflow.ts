// TODO: Replace/align with Supabase generated types (`supabase gen types typescript`)
// once the schema is deployed. These mirror supabase/migrations/001_initial_schema.sql.

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
