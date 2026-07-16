"use client";

import { useState } from "react";
import { Loader2, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import clsx from "clsx";

type Prefs = {
  show_macros: boolean;
  macro_focus: string;
  preferred_meal_prep_time: string;
  cooking_skill: string;
  movement_preference: string[];
  movement_limitations: string;
  stress_reset_preference: string[];
  meditation_experience: string;
  preferred_routine_length: string;
  // v4 (Prompt 4)
  schedule_type: string;
  meal_pattern: string;
  disliked_ingredients: string[];
  kitchen_equipment: string[];
  default_servings: number;
  reminders_opt_in: boolean;
  reminder_time: string;
  quiet_hours_start: string;
  quiet_hours_end: string;
};

const SCHEDULE_TYPE = [
  { value: "office", label: "Office" },
  { value: "home", label: "Home" },
  { value: "caregiving", label: "Caregiving" },
  { value: "shift", label: "Shift work" },
  { value: "travel", label: "Travel" },
  { value: "irregular", label: "Irregular" },
];
const MEAL_PATTERN = [
  { value: "three_meals", label: "3 meals" },
  { value: "two_meals", label: "2 meals" },
  { value: "small_frequent", label: "Small & frequent" },
  { value: "flexible", label: "Flexible" },
];
const KITCHEN_EQUIPMENT = [
  { value: "stovetop", label: "Stovetop" },
  { value: "oven", label: "Oven" },
  { value: "microwave", label: "Microwave" },
  { value: "blender", label: "Blender" },
  { value: "air_fryer", label: "Air fryer" },
  { value: "minimal", label: "Minimal / none" },
];

// General meal-style preferences only — never nutrition targets (Prompt 7).
const MACRO_FOCUS = [
  { value: "balanced", label: "Balanced" },
  { value: "protein_rich", label: "Protein-rich meals" },
  { value: "budget_friendly", label: "Budget-friendly" },
  { value: "low_effort", label: "Low effort" },
];
const PREP_TIME = [
  { value: "under_10", label: "Under 10 min" },
  { value: "under_20", label: "Under 20 min" },
  { value: "under_30", label: "Under 30 min" },
  { value: "flexible", label: "Flexible" },
];
const COOKING_SKILL = [
  { value: "beginner", label: "Beginner" },
  { value: "comfortable", label: "Comfortable" },
];
const MOVEMENT_PREF = [
  { value: "walking", label: "Walking" },
  { value: "stretching", label: "Stretching" },
  { value: "mobility", label: "Mobility" },
  { value: "strength", label: "Strength" },
  { value: "desk_reset", label: "Desk reset" },
];
const STRESS_PREF = [
  { value: "breathing", label: "Breathing" },
  { value: "meditation", label: "Meditation" },
  { value: "journaling", label: "Journaling" },
  { value: "grounding", label: "Grounding" },
  { value: "relaxation", label: "Relaxation" },
];
const MEDITATION_EXP = [
  { value: "beginner", label: "Beginner" },
  { value: "some_experience", label: "Some experience" },
];
const ROUTINE_LENGTH = [
  { value: "5_min", label: "5 min" },
  { value: "10_min", label: "10 min" },
  { value: "20_min", label: "20 min" },
  { value: "flexible", label: "Flexible" },
];

function Chips({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(value === o.value ? "" : o.value)}
          className={clsx(
            "rounded-full border px-3 py-1.5 text-sm transition",
            value === o.value
              ? "border-[#7C9A92] bg-[#7C9A92]/10 font-medium text-[#1F2937]"
              : "border-[#E5E1DA] bg-white text-[#6B7280] hover:border-[#7C9A92]/50"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function MultiChips({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => toggle(o.value)}
          className={clsx(
            "rounded-full border px-3 py-1.5 text-sm transition",
            value.includes(o.value)
              ? "border-[#7C9A92] bg-[#7C9A92]/10 font-medium text-[#1F2937]"
              : "border-[#E5E1DA] bg-white text-[#6B7280] hover:border-[#7C9A92]/50"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PlanPreferencesForm({
  userId,
  initial,
}: {
  userId: string;
  initial: Partial<Prefs>;
}) {
  const [prefs, setPrefs] = useState<Prefs>({
    show_macros: initial.show_macros ?? false,
    macro_focus: initial.macro_focus ?? "",
    preferred_meal_prep_time: initial.preferred_meal_prep_time ?? "",
    cooking_skill: initial.cooking_skill ?? "",
    movement_preference: initial.movement_preference ?? [],
    movement_limitations: initial.movement_limitations ?? "",
    stress_reset_preference: initial.stress_reset_preference ?? [],
    meditation_experience: initial.meditation_experience ?? "",
    preferred_routine_length: initial.preferred_routine_length ?? "",
    schedule_type: initial.schedule_type ?? "",
    meal_pattern: initial.meal_pattern ?? "",
    disliked_ingredients: initial.disliked_ingredients ?? [],
    kitchen_equipment: initial.kitchen_equipment ?? [],
    default_servings: initial.default_servings ?? 1,
    reminders_opt_in: initial.reminders_opt_in ?? false,
    reminder_time: initial.reminder_time ?? "",
    quiet_hours_start: initial.quiet_hours_start ?? "",
    quiet_hours_end: initial.quiet_hours_end ?? "",
  });
  const [dislikedText, setDislikedText] = useState(
    (initial.disliked_ingredients ?? []).join(", ")
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    setPrefs((p) => ({ ...p, [k]: v }));
    setSaved(false);
  };

  async function save() {
    setSaving(true);
    const disliked = dislikedText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const supabase = createClient();
    await supabase
      .from("wellbeing_profiles")
      .update({
        show_macros: prefs.show_macros,
        macro_focus: prefs.macro_focus || null,
        preferred_meal_prep_time: prefs.preferred_meal_prep_time || null,
        cooking_skill: prefs.cooking_skill || null,
        movement_preference: prefs.movement_preference,
        movement_limitations: prefs.movement_limitations || null,
        stress_reset_preference: prefs.stress_reset_preference,
        meditation_experience: prefs.meditation_experience || null,
        preferred_routine_length: prefs.preferred_routine_length || null,
        schedule_type: prefs.schedule_type || null,
        meal_pattern: prefs.meal_pattern || null,
        disliked_ingredients: disliked,
        kitchen_equipment: prefs.kitchen_equipment,
        default_servings: prefs.default_servings,
        reminders_opt_in: prefs.reminders_opt_in,
        reminder_time: prefs.reminder_time || null,
        quiet_hours_start: prefs.quiet_hours_start || null,
        quiet_hours_end: prefs.quiet_hours_end || null,
      })
      .eq("user_id", userId);
    setSaving(false);
    setSaved(true);
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <h2 className="font-medium text-[#1F2937]">Plan preferences</h2>
      <p className="mt-1 text-sm text-[#6B7280]">
        Fine-tune how Mellowa builds your daily plan.
      </p>

      <div className="mt-4 space-y-5">
        {/* Nutrition estimates — explicit opt-in, off by default (Prompt 7) */}
        <label className="flex cursor-pointer items-start gap-3 text-sm text-[#1F2937]">
          <input
            type="checkbox"
            checked={prefs.show_macros}
            onChange={(e) => set("show_macros", e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[#7C9A92]"
          />
          <span>
            Show approximate nutrition estimates
            <span className="block text-xs text-[#6B7280]">
              General estimates only, never targets. You can hide them anytime.
            </span>
          </span>
        </label>

        <div>
          <p className="mb-2 text-sm font-medium text-[#1F2937]">Meal focus</p>
          <Chips
            options={MACRO_FOCUS}
            value={prefs.macro_focus}
            onChange={(v) => set("macro_focus", v)}
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-[#1F2937]">Meal prep time</p>
          <Chips
            options={PREP_TIME}
            value={prefs.preferred_meal_prep_time}
            onChange={(v) => set("preferred_meal_prep_time", v)}
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-[#1F2937]">Cooking skill</p>
          <Chips
            options={COOKING_SKILL}
            value={prefs.cooking_skill}
            onChange={(v) => set("cooking_skill", v)}
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-[#1F2937]">
            Movement you enjoy
          </p>
          <MultiChips
            options={MOVEMENT_PREF}
            value={prefs.movement_preference}
            onChange={(v) => set("movement_preference", v)}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-[#1F2937]">
            Movement limitations{" "}
            <span className="font-normal text-[#6B7280]">(optional)</span>
          </label>
          <input
            type="text"
            value={prefs.movement_limitations}
            onChange={(e) => set("movement_limitations", e.target.value)}
            placeholder="e.g. sensitive knees, prefer no floor work"
            className="w-full rounded-xl border border-[#E5E1DA] px-4 py-2.5 text-sm text-[#1F2937] placeholder:text-[#9CA3AF] focus:border-[#7C9A92] focus:outline-none"
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-[#1F2937]">
            Stress reset you like
          </p>
          <MultiChips
            options={STRESS_PREF}
            value={prefs.stress_reset_preference}
            onChange={(v) => set("stress_reset_preference", v)}
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-[#1F2937]">
            Meditation experience
          </p>
          <Chips
            options={MEDITATION_EXP}
            value={prefs.meditation_experience}
            onChange={(v) => set("meditation_experience", v)}
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-[#1F2937]">
            Preferred routine length
          </p>
          <Chips
            options={ROUTINE_LENGTH}
            value={prefs.preferred_routine_length}
            onChange={(v) => set("preferred_routine_length", v)}
          />
        </div>

        <div className="border-t border-[#F0EDE7] pt-5">
          <p className="mb-2 text-sm font-medium text-[#1F2937]">Typical day</p>
          <Chips
            options={SCHEDULE_TYPE}
            value={prefs.schedule_type}
            onChange={(v) => set("schedule_type", v)}
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-[#1F2937]">Meal pattern</p>
          <Chips
            options={MEAL_PATTERN}
            value={prefs.meal_pattern}
            onChange={(v) => set("meal_pattern", v)}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-[#1F2937]">
            Foods you&apos;d rather avoid{" "}
            <span className="font-normal text-[#6B7280]">
              (taste, not allergy — comma separated)
            </span>
          </label>
          <input
            type="text"
            value={dislikedText}
            onChange={(e) => {
              setDislikedText(e.target.value);
              setSaved(false);
            }}
            placeholder="e.g. mushrooms, cilantro, olives"
            className="w-full rounded-xl border border-[#E5E1DA] px-4 py-2.5 text-sm text-[#1F2937] placeholder:text-[#9CA3AF] focus:border-[#7C9A92] focus:outline-none"
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-[#1F2937]">
            Kitchen equipment
          </p>
          <MultiChips
            options={KITCHEN_EQUIPMENT}
            value={prefs.kitchen_equipment}
            onChange={(v) => set("kitchen_equipment", v)}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-[#1F2937]">
            Default servings per meal
          </label>
          <input
            type="number"
            min={1}
            max={8}
            value={prefs.default_servings}
            onChange={(e) =>
              set(
                "default_servings",
                Math.min(8, Math.max(1, Number(e.target.value) || 1))
              )
            }
            className="w-24 rounded-xl border border-[#E5E1DA] px-4 py-2.5 text-sm text-[#1F2937] focus:border-[#7C9A92] focus:outline-none"
          />
        </div>

        <div className="border-t border-[#F0EDE7] pt-5">
          <label className="flex cursor-pointer items-start gap-3 text-sm text-[#1F2937]">
            <input
              type="checkbox"
              checked={prefs.reminders_opt_in}
              onChange={(e) => set("reminders_opt_in", e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#7C9A92]"
            />
            Send me a gentle daily reminder
          </label>
          {prefs.reminders_opt_in && (
            <div className="mt-3">
              <label className="mb-1 block text-sm font-medium text-[#1F2937]">
                Preferred reminder time
              </label>
              <input
                type="time"
                value={prefs.reminder_time}
                onChange={(e) => set("reminder_time", e.target.value)}
                className="w-32 rounded-xl border border-[#E5E1DA] px-4 py-2.5 text-sm text-[#1F2937] focus:border-[#7C9A92] focus:outline-none"
              />
            </div>
          )}
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-[#1F2937]">
            Quiet hours{" "}
            <span className="font-normal text-[#6B7280]">(no reminders)</span>
          </p>
          <div className="flex items-center gap-2 text-sm text-[#6B7280]">
            <input
              type="time"
              value={prefs.quiet_hours_start}
              onChange={(e) => set("quiet_hours_start", e.target.value)}
              className="w-32 rounded-xl border border-[#E5E1DA] px-4 py-2.5 text-[#1F2937] focus:border-[#7C9A92] focus:outline-none"
            />
            <span>to</span>
            <input
              type="time"
              value={prefs.quiet_hours_end}
              onChange={(e) => set("quiet_hours_end", e.target.value)}
              className="w-32 rounded-xl border border-[#E5E1DA] px-4 py-2.5 text-[#1F2937] focus:border-[#7C9A92] focus:outline-none"
            />
          </div>
        </div>
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="mt-6 flex items-center gap-2 rounded-xl bg-[#7C9A92] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#6D8C7D] disabled:opacity-60"
      >
        {saving ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : saved ? (
          <Check className="h-4 w-4" />
        ) : null}
        {saved ? "Saved" : "Save preferences"}
      </button>
    </div>
  );
}
