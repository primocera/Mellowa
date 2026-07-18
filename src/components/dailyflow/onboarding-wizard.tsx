"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ArrowLeft, ArrowRight, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  WellbeingProfileInput,
  CONSENT_VERSION,
  type WellbeingProfileInputType,
} from "@/schemas/wellbeing";
import clsx from "clsx";
import { normalizeAllergies } from "@/lib/safety/allergens";
import {
  validateSleepWindow,
  detectMedicalNutritionSignal,
  MEDICAL_NUTRITION_MESSAGE,
} from "@/lib/onboarding/validation";

// Prompt 12: resume an interrupted first run. The draft is non-sensitive
// onboarding input; we clear it as soon as the profile is saved.
const DRAFT_KEY = "mellowa.onboarding.draft.v1";

const STEPS = [
  "Your rhythm",
  "What you want help with",
  "Food that fits",
  "Your usual capacity",
  "Voice",
  "Boundaries",
] as const;

// Display labels are concrete daily-life outcomes (CE-6); the stored values
// stay unchanged so existing profiles and AI prompts keep working.
const GOALS: { value: WellbeingProfileInputType["primary_goal"]; label: string }[] = [
  { value: "better_meal_rhythm", label: "Eat more regularly" },
  { value: "general_wellbeing_structure", label: "Have steadier daily structure" },
  { value: "more_energy", label: "Make room for movement" },
  { value: "better_sleep_routine", label: "Wind down more easily" },
  { value: "habit_consistency", label: "Build one repeatable habit" },
  { value: "less_overwhelm", label: "Feel less scattered" },
];

const COOKING_TIMES = [
  { value: "under_15", label: "Under 15 min" },
  { value: "15_30", label: "15–30 min" },
  { value: "30_60", label: "30–60 min" },
  { value: "over_60", label: "I enjoy longer cooking" },
] as const;

const BUDGETS = [
  { value: "low", label: "Budget-friendly" },
  { value: "medium", label: "Moderate" },
  { value: "flexible", label: "Flexible" },
] as const;

const MOVEMENT = [
  { value: "mostly_sitting", label: "Mostly sitting" },
  { value: "lightly_active", label: "Lightly active" },
  { value: "active", label: "Active" },
  { value: "very_active", label: "Very active" },
] as const;

// Display names elevated (CE-6); stored values unchanged for existing profiles.
const TONES = [
  { value: "gentle", label: "Warm", hint: "Kind and encouraging, without being overly cheerful." },
  { value: "direct", label: "Clear", hint: "Direct, practical and concise." },
  { value: "minimal", label: "Quiet", hint: "Minimal words and very little encouragement." },
  { value: "encouraging", label: "Encouraging", hint: "Warm, with more active support." },
] as const;

type Draft = {
  wake_time: string;
  sleep_time: string;
  work_schedule: string;
  primary_goal: string;
  food_preferences: string;
  allergies: string;
  disliked_ingredients: string;
  cooking_time: string;
  budget_level: string;
  energy_baseline: number;
  stress_baseline: number;
  sleep_quality_baseline: number;
  movement_level: string;
  preferred_tone: string;
  safety_acknowledged: boolean;
  is_adult: boolean;
  allergies_severe: boolean;
};

const INITIAL: Draft = {
  wake_time: "07:00",
  sleep_time: "23:00",
  work_schedule: "",
  primary_goal: "",
  food_preferences: "",
  allergies: "",
  disliked_ingredients: "",
  cooking_time: "",
  budget_level: "",
  energy_baseline: 3,
  stress_baseline: 3,
  sleep_quality_baseline: 3,
  movement_level: "",
  preferred_tone: "",
  safety_acknowledged: false,
  is_adult: false,
  allergies_severe: false,
};

function Scale({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-[#1F2937]">{label}</p>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={clsx(
              "h-11 flex-1 rounded-xl border text-sm font-medium transition",
              value === n
                ? "border-[#7C9A92] bg-[#7C9A92] text-white"
                : "border-[#E5E1DA] bg-white text-[#6B7280] hover:border-[#7C9A92]/50"
            )}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

function OptionGrid<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string; hint?: string }[];
  value: string;
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={clsx(
            "rounded-xl border px-4 py-3 text-left text-sm transition",
            value === opt.value
              ? "border-[#7C9A92] bg-[#7C9A92]/10 font-medium text-[#1F2937]"
              : "border-[#E5E1DA] bg-white text-[#6B7280] hover:border-[#7C9A92]/50"
          )}
        >
          {opt.label}
          {opt.hint && <span className="mt-0.5 block text-xs text-[#6B7280]">{opt.hint}</span>}
        </button>
      ))}
    </div>
  );
}

export function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(INITIAL);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Resume a previous draft on mount, then persist on every change so a
  // refresh doesn't lose work. `loaded` gates persistence until after the
  // one-time read, so we never overwrite a saved draft with the initial state.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let restored: Partial<Draft> | null = null;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) restored = JSON.parse(raw) as Partial<Draft>;
    } catch {
      /* ignore malformed drafts */
    }
    // One-time hydration from storage — the documented exception to the
    // no-setState-in-effect rule (react.dev "you might not need an effect").
    /* eslint-disable react-hooks/set-state-in-effect */
    if (restored) setDraft((d) => ({ ...d, ...restored }));
    setLoaded(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* storage may be unavailable; onboarding still works in-memory */
    }
  }, [draft, loaded]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const sleepWindow = validateSleepWindow(draft.wake_time, draft.sleep_time);
  const medicalSignal = detectMedicalNutritionSignal(
    draft.food_preferences,
    draft.allergies,
    draft.disliked_ingredients
  );

  const stepValid = () => {
    switch (step) {
      case 0:
        return (
          !!draft.wake_time &&
          !!draft.sleep_time &&
          !!draft.work_schedule.trim() &&
          sleepWindow.ok
        );
      case 1:
        return !!draft.primary_goal;
      case 2:
        return !!draft.cooking_time && !!draft.budget_level;
      case 3:
        return !!draft.movement_level;
      case 4:
        return !!draft.preferred_tone;
      case 5:
        return draft.safety_acknowledged && draft.is_adult;
      default:
        return false;
    }
  };

  async function finish() {
    setError(null);

    const parsed = WellbeingProfileInput.safeParse({
      ...draft,
      food_preferences: draft.food_preferences
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      allergies: draft.allergies
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      disliked_ingredients: draft.disliked_ingredients
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      timezone:
        typeof Intl !== "undefined"
          ? Intl.DateTimeFormat().resolvedOptions().timeZone
          : "",
      locale: typeof navigator !== "undefined" ? navigator.language : "",
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check your answers.");
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const d = parsed.data;
    const { error: dbError } = await supabase.from("wellbeing_profiles").upsert(
      {
        user_id: user.id,
        wake_time: d.wake_time,
        sleep_time: d.sleep_time,
        work_schedule: d.work_schedule,
        primary_goal: d.primary_goal,
        food_preferences: d.food_preferences,
        allergies: d.allergies,
        disliked_ingredients: d.disliked_ingredients,
        cooking_time: d.cooking_time,
        budget_level: d.budget_level,
        movement_level: d.movement_level,
        sleep_quality_baseline: String(d.sleep_quality_baseline),
        stress_baseline: String(d.stress_baseline),
        preferred_tone: d.preferred_tone,
        safety_acknowledged: d.safety_acknowledged,
        is_adult: d.is_adult,
        allergies_severe: draft.allergies_severe,
        timezone: d.timezone || null,
        locale: d.locale || null,
        consent_version: CONSENT_VERSION,
        consent_accepted_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    if (dbError) {
      setError(dbError.message);
      setSaving(false);
      return;
    }

    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* best effort */
    }
    router.push("/check-in");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-lg">
      {/* Progress */}
      <div className="mb-6">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-[#6B7280]">
            Step {step + 1} of {STEPS.length} • {STEPS[step]}
          </p>
          {loaded && <p className="text-xs text-[#9CA3AF]">Saved on this device</p>}
        </div>
        <div className="flex gap-1.5">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={clsx(
                "h-1.5 flex-1 rounded-full",
                i <= step ? "bg-[#7C9A92]" : "bg-[#E5E1DA]"
              )}
            />
          ))}
        </div>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm sm:p-8">
        {step === 0 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-[#1F2937]">
              When does your day usually begin and end?
            </h2>
            <p className="text-sm text-[#6B7280]">
              Approximate is enough. This helps Mellowa place meals and the
              evening wind-down realistically.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-[#1F2937]">Usual wake time</label>
                <input
                  type="time"
                  value={draft.wake_time}
                  onChange={(e) => set("wake_time", e.target.value)}
                  className="w-full rounded-xl border border-[#E5E1DA] px-4 py-3 text-[#1F2937] focus:border-[#7C9A92] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-[#1F2937]">Usual sleep time</label>
                <input
                  type="time"
                  value={draft.sleep_time}
                  onChange={(e) => set("sleep_time", e.target.value)}
                  className="w-full rounded-xl border border-[#E5E1DA] px-4 py-3 text-[#1F2937] focus:border-[#7C9A92] focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[#1F2937]">
                What does your schedule look like?
              </label>
              <input
                type="text"
                value={draft.work_schedule}
                onChange={(e) => set("work_schedule", e.target.value)}
                placeholder="Office hours, shifts, caregiving, variable days…"
                className="w-full rounded-xl border border-[#E5E1DA] px-4 py-3 text-[#1F2937] placeholder:text-[#9CA3AF] focus:border-[#7C9A92] focus:outline-none"
              />
            </div>
            {draft.wake_time && draft.sleep_time && !sleepWindow.ok && (
              <p className="text-xs text-[#B45309]">{sleepWindow.message}</p>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-[#1F2937]">
              What would make daily life easier right now?
            </h2>
            <OptionGrid
              options={GOALS}
              value={draft.primary_goal}
              onChange={(v) => set("primary_goal", v)}
            />
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-[#1F2937]">
              What should meals work around?
            </h2>
            {medicalSignal && (
              <div className="rounded-xl bg-[#FEE2E2] px-4 py-3 text-sm text-[#991B1B]">
                {MEDICAL_NUTRITION_MESSAGE}
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-[#1F2937]">
                Eating preferences <span className="font-normal text-[#6B7280]">(comma separated, optional)</span>
              </label>
              <input
                type="text"
                value={draft.food_preferences}
                onChange={(e) => set("food_preferences", e.target.value)}
                placeholder="e.g. vegetarian, loves pasta, no fish"
                className="w-full rounded-xl border border-[#E5E1DA] px-4 py-3 text-[#1F2937] placeholder:text-[#9CA3AF] focus:border-[#7C9A92] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[#1F2937]">
                Allergies or intolerances <span className="font-normal text-[#6B7280]">(optional)</span>
              </label>
              <input
                type="text"
                value={draft.allergies}
                onChange={(e) => set("allergies", e.target.value)}
                placeholder="e.g. lactose, nuts"
                className="w-full rounded-xl border border-[#E5E1DA] px-4 py-3 text-[#1F2937] placeholder:text-[#9CA3AF] focus:border-[#7C9A92] focus:outline-none"
              />
              <p className="mt-1 text-xs text-[#6B7280]">
                Allergies are a safety limit — we build meals without them. For a
                severe allergy, always double-check product labels.
              </p>
              {(() => {
                const { customTerms } = normalizeAllergies(
                  draft.allergies.split(",").map((s) => s.trim()).filter(Boolean)
                );
                return customTerms.length > 0 ? (
                  <p className="mt-1 text-xs text-[#B45309]">
                    We don&apos;t recognise{" "}
                    <strong>{customTerms.join(", ")}</strong> as a common allergen
                    category — we&apos;ll still exclude these exact words from
                    meals, but please double-check ingredient lists yourself.
                  </p>
                ) : null;
              })()}
              <label className="mt-2 flex items-start gap-2.5 text-sm text-[#1F2937]">
                <input
                  type="checkbox"
                  checked={draft.allergies_severe}
                  onChange={(e) => set("allergies_severe", e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-[#E5E1DA] accent-[#7C9A92]"
                />
                <span>
                  One of these is severe or life-threatening (e.g. anaphylaxis).
                  <span className="block text-xs text-[#6B7280]">
                    Mellowa won&apos;t suggest specific meals for severe
                    allergies — automated checks can&apos;t guarantee label or
                    cross-contamination safety at that level. You can still use
                    non-food planning features.
                  </span>
                </span>
              </label>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[#1F2937]">
                Foods you prefer not to eat{" "}
                <span className="font-normal text-[#6B7280]">(taste, not allergy — optional)</span>
              </label>
              <input
                type="text"
                value={draft.disliked_ingredients}
                onChange={(e) => set("disliked_ingredients", e.target.value)}
                placeholder="e.g. mushrooms, cilantro, olives"
                className="w-full rounded-xl border border-[#E5E1DA] px-4 py-3 text-[#1F2937] placeholder:text-[#9CA3AF] focus:border-[#7C9A92] focus:outline-none"
              />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-[#1F2937]">Usual cooking time</p>
              <OptionGrid
                options={COOKING_TIMES}
                value={draft.cooking_time}
                onChange={(v) => set("cooking_time", v)}
              />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-[#1F2937]">Budget comfort</p>
              <OptionGrid
                options={BUDGETS}
                value={draft.budget_level}
                onChange={(v) => set("budget_level", v)}
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-[#1F2937]">
              What does a typical week feel like?
            </h2>
            <p className="text-sm text-[#6B7280]">
              This is a starting point, not a score. Daily check-ins can
              override it.
            </p>
            <Scale
              label="Usual energy (1 = usually low, 5 = usually plenty)"
              value={draft.energy_baseline}
              onChange={(v) => set("energy_baseline", v)}
            />
            <Scale
              label="Usual stress (1 = rarely stretched, 5 = often stretched)"
              value={draft.stress_baseline}
              onChange={(v) => set("stress_baseline", v)}
            />
            <Scale
              label="Usual sleep (1 = often disrupted, 5 = mostly restful)"
              value={draft.sleep_quality_baseline}
              onChange={(v) => set("sleep_quality_baseline", v)}
            />
            <div>
              <p className="mb-2 text-sm font-medium text-[#1F2937]">Movement in a normal day</p>
              <OptionGrid
                options={MOVEMENT}
                value={draft.movement_level}
                onChange={(v) => set("movement_level", v)}
              />
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-[#1F2937]">
              How should Mellowa sound?
            </h2>
            <OptionGrid
              options={TONES}
              value={draft.preferred_tone}
              onChange={(v) => set("preferred_tone", v)}
            />
          </div>
        )}

        {step === 5 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-[#1F2937]">Before your first plan</h2>
            <div className="rounded-xl bg-[#EEF2FF] px-4 py-4 text-sm leading-relaxed text-[#1F2937]">
              Mellowa provides general wellbeing structure for adults. It is not
              medical care, therapy, emergency support or a condition-specific
              nutrition service. For medical conditions, eating disorder concerns,
              pregnancy, severe mental health symptoms or emergencies, please seek
              qualified professional support.
            </div>
            <p className="text-xs leading-relaxed text-[#6B7280]">
              How your answers are used: the rhythm, food and baseline details you
              share are sent to our AI provider to generate your personal plans.
              They&apos;re never used to advertise to you, and you can export or
              delete everything at any time from You → Your data.
            </p>
            <label className="flex cursor-pointer items-start gap-3 text-sm text-[#1F2937]">
              <input
                type="checkbox"
                checked={draft.safety_acknowledged}
                onChange={(e) => set("safety_acknowledged", e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[#7C9A92]"
              />
              I understand what Mellowa can and cannot provide.
            </label>
            <label className="flex cursor-pointer items-start gap-3 text-sm text-[#1F2937]">
              <input
                type="checkbox"
                checked={draft.is_adult}
                onChange={(e) => set("is_adult", e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[#7C9A92]"
              />
              I confirm I am 18 years or older.
            </label>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-xl bg-[#FEE2E2] px-4 py-3 text-sm text-[#991B1B]"
          >
            {error}
          </div>
        )}

        {/* Nav buttons */}
        <div className="mt-8 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0 || saving}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium text-[#6B7280] transition hover:text-[#1F2937] disabled:invisible"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>

          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              disabled={!stepValid()}
              className="flex items-center gap-1.5 rounded-xl bg-[#7C9A92] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#6D8C7D] disabled:opacity-50"
            >
              Continue
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={finish}
              disabled={!stepValid() || saving}
              className="flex items-center gap-1.5 rounded-xl bg-[#7C9A92] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#6D8C7D] disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Create my first check-in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
