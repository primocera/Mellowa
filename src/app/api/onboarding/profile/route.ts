import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getConsentStatus } from "@/lib/consent/status";
import { WellbeingProfileInput, CONSENT_VERSION } from "@/schemas/wellbeing";

/**
 * Saves the onboarding wellbeing baseline (allergies, a severe-allergy flag,
 * stress/sleep baselines — GDPR Art. 9 health-adjacent data) SERVER-side.
 *
 * Previously the browser upserted wellbeing_profiles directly, so the only
 * validation was client-side and the client chose its own consent_version /
 * consent_accepted_at. Now:
 *  1. the caller must be signed in (401);
 *  2. the caller must hold every required consent at the current policy
 *     versions — the same check guardAiRoute applies before generation — or
 *     nothing is stored (403 consent_required);
 *  3. the body is validated with the shared Zod schema (400 invalid_input);
 *  4. the row is upserted through the user's own session client (RLS applies),
 *     and the SERVER stamps consent_version / consent_accepted_at — any value
 *     the client sends for them is stripped by the schema and ignored.
 */

const ProfileBody = WellbeingProfileInput.extend({
  // Kept separate from the allergies list (a safety field, not a preference).
  allergies_severe: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Consent first: without current-version consent, no health data is stored.
  const consent = await getConsentStatus(user.id);
  if (!consent.complete) {
    return NextResponse.json(
      { error: "consent_required", missing: consent.missing },
      { status: 403 }
    );
  }

  const parsed = ProfileBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_input",
        // The first issue's message is customer-safe copy authored in the schema.
        user_message: parsed.error.issues[0]?.message ?? "Please check your answers.",
      },
      { status: 400 }
    );
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
      allergies_severe: d.allergies_severe,
      timezone: d.timezone || null,
      locale: d.locale || null,
      // Server-authoritative: the version of the in-wizard safety/privacy
      // acknowledgement this baseline was saved under, and when.
      consent_version: CONSENT_VERSION,
      consent_accepted_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (dbError) {
    // Raw provider errors are never returned to the browser.
    console.error("[onboarding/profile] save failed", { code: dbError.code });
    return NextResponse.json({ error: "save_failed", retryable: true }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
