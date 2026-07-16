import {
  detectSevereAllergySignal,
  SEVERE_ALLERGY_MESSAGE,
} from "./allergens";

/**
 * Severe-allergy gate (Prompt 8, audit v5). Meal-generating routes call this
 * after loading the wellbeing profile; a non-null result must be returned to
 * the client as-is (same shape as safety blocks) instead of generating
 * specific meals.
 */
export function severeAllergyBlock(profile: {
  allergies?: string[] | null;
  allergies_severe?: boolean | null;
}): { blocked: true; user_message: string } | null {
  const severe =
    profile.allergies_severe === true ||
    detectSevereAllergySignal(profile.allergies ?? []);
  return severe ? { blocked: true, user_message: SEVERE_ALLERGY_MESSAGE } : null;
}
