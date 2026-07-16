// Prompt 12: pure onboarding helpers — time-relationship validation and
// medical-nutrition redirection — kept free of React so they can be tested
// directly and reused on the server.

/** Minutes since midnight for a "HH:MM" string, or null if unparseable. */
export function minutesOf(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Waking window in minutes, treating sleep as crossing midnight when it is
 * earlier than wake. Returns null if either time is invalid.
 */
export function wakingMinutes(wake: string, sleep: string): number | null {
  const w = minutesOf(wake);
  const s = minutesOf(sleep);
  if (w === null || s === null) return null;
  const span = s - w;
  return span > 0 ? span : span + 24 * 60;
}

/**
 * A plausible day has a waking window between 6 and 22 hours. Identical
 * wake/sleep times, or an implausibly short/long window, are rejected with a
 * gentle message.
 */
export function validateSleepWindow(
  wake: string,
  sleep: string
): { ok: boolean; message?: string } {
  const awake = wakingMinutes(wake, sleep);
  if (awake === null) return { ok: false, message: "Please enter valid times." };
  if (awake < 6 * 60 || awake > 22 * 60) {
    return {
      ok: false,
      message:
        "That leaves an unusual amount of time awake — please double-check your wake and sleep times.",
    };
  }
  return { ok: true };
}

// Terms that signal a need for professional, condition-specific nutrition
// guidance Mellowa must not attempt. Free-text is lower-cased before matching.
const MEDICAL_NUTRITION_TERMS = [
  "diabetes",
  "diabetic",
  "insulin",
  "kidney",
  "renal",
  "dialysis",
  "cancer",
  "chemo",
  "pregnant",
  "pregnancy",
  "breastfeeding",
  "postpartum",
  "eating disorder",
  "anorexia",
  "bulimia",
  "coeliac",
  "celiac",
  "crohn",
  "ulcerative colitis",
  "gastric bypass",
  "bariatric",
];

/**
 * Detects when free-text food fields describe a medical condition that needs
 * qualified support rather than an automated plan. Returns the matched term
 * so the UI can gently redirect without blocking onboarding.
 */
export function detectMedicalNutritionSignal(...fields: string[]): string | null {
  const hay = fields.join(" ").toLowerCase();
  for (const term of MEDICAL_NUTRITION_TERMS) {
    if (hay.includes(term)) return term;
  }
  return null;
}

export const MEDICAL_NUTRITION_MESSAGE =
  "It sounds like a medical condition may shape your nutrition. Mellowa offers general wellbeing routines, not condition-specific medical nutrition — please plan meals with a qualified professional. You can still use Mellowa for gentle structure.";
