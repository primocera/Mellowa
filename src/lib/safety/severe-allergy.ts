import {
  detectSevereAllergySignal,
  SEVERE_ALLERGY_MESSAGE,
} from "./allergens";

type AllergyProfile = {
  allergies?: string[] | null;
  allergies_severe?: boolean | null;
};

/**
 * True when the profile carries a severe / life-threatening allergy, via the
 * explicit onboarding flag or a text signal in the listed allergies. Automated
 * ingredient/label/cross-contamination checks can't be trusted at this level,
 * so Mellowa never suggests specific meals for these users.
 */
export function isSevereAllergy(profile: AllergyProfile): boolean {
  return (
    profile.allergies_severe === true ||
    detectSevereAllergySignal(profile.allergies ?? [])
  );
}

/**
 * Severe-allergy gate (Prompt 8, audit v5) for MEAL-ONLY routes (meal-rhythm,
 * weekly-plan, low-energy-day, favourite-meal). A non-null result must be
 * returned to the client as-is (same shape as safety blocks) instead of
 * generating specific meals — for these routes the whole output IS meals, so
 * there is nothing safe left to return.
 *
 * The general daily plan does NOT use this: it strips meals but still returns
 * the non-meal sections (movement, calm reset, hydration, sleep). See
 * `stripMealsForSevereAllergy`.
 */
export function severeAllergyBlock(
  profile: AllergyProfile
): { blocked: true; user_message: string } | null {
  return isSevereAllergy(profile)
    ? { blocked: true, user_message: SEVERE_ALLERGY_MESSAGE }
    : null;
}

/**
 * Fail-closed meal removal for a severe-allergy user's daily plan. Deterministic
 * and independent of the model: whatever meals were generated are discarded, so
 * no specific meal can ever reach the user even if the prompt was ignored. The
 * non-meal sections are untouched, and the severe-allergy boundary message is
 * appended to the plan's safety note.
 */
export function stripMealsForSevereAllergy<
  T extends { meal_cards: unknown[]; safety_note?: string | null }
>(plan: T): T {
  plan.meal_cards = [];
  plan.safety_note = plan.safety_note
    ? `${plan.safety_note} ${SEVERE_ALLERGY_MESSAGE}`
    : SEVERE_ALLERGY_MESSAGE;
  return plan;
}
