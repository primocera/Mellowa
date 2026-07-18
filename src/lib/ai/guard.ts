import "server-only";
import { NextResponse } from "next/server";
import { getUserSubscriptionStatus } from "@/lib/stripe/subscription";
import { claimAiGeneration, type AiRoute } from "@/lib/ai/rate-limit";
import { getConsentStatus } from "@/lib/consent/status";
import { isGenerationDisabled } from "@/lib/admin/support";

/**
 * Shared gate for AI generation routes. Protects the AI provider key by:
 *  1. Requiring an active/trialing subscription for premium routes.
 *  2. Atomically reserving the generation against per-user rate limits and the
 *     global daily spend ceiling (Prompt 16).
 *
 * The sample tier's single daily-plan preview is handled separately by
 * canGenerateDailyPlan; pass requirePremium: false there.
 *
 * Returns a NextResponse to short-circuit the route, or a GuardPass (carrying
 * the reserved ledger eventId) to continue. On a global-capacity block returns
 * HTTP 503 so the route may serve a curated fallback instead of a hard error.
 */
export interface GuardPass {
  /** Reserved ai_usage_events row id, to finalize after generation (Prompt 11). */
  eventId?: string;
}

export async function guardAiRoute(
  userId: string,
  opts: { requirePremium: boolean; route: AiRoute }
): Promise<NextResponse | GuardPass> {
  // Operator abuse switch (Prompt 17): a disabled account gets a calm,
  // non-accusatory message and no provider call.
  if (await isGenerationDisabled(userId)) {
    return NextResponse.json(
      {
        error: "generation_unavailable",
        user_message:
          "Plan generation is paused on this account. Please contact support if you think this is a mistake.",
      },
      { status: 403 }
    );
  }

  // Consent checkpoint (Prompt 6): existing users without current-version
  // age/terms/privacy consent must complete it before any new generation.
  const consent = await getConsentStatus(userId);
  if (!consent.complete) {
    return NextResponse.json(
      { error: "consent_required", missing: consent.missing },
      { status: 403 }
    );
  }

  if (opts.requirePremium) {
    const sub = await getUserSubscriptionStatus(userId);
    if (!sub.isPremium) {
      return NextResponse.json(
        { error: "premium_required", scope: "ai" },
        { status: 402 }
      );
    }
  }

  const claim = await claimAiGeneration(userId, opts.route);
  if (!claim.ok) {
    if (claim.scope === "capacity") {
      return NextResponse.json(
        {
          error: "capacity",
          user_message:
            "Mellowa is at capacity right now. Please try again a little later.",
          retryAfterMinutes: claim.retryAfterMinutes,
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      {
        error: "rate_limited",
        scope: claim.scope,
        retryAfterMinutes: claim.retryAfterMinutes,
      },
      { status: 429 }
    );
  }

  return { eventId: claim.eventId };
}
