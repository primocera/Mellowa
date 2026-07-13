import "server-only";
import { NextResponse } from "next/server";
import { getUserSubscriptionStatus } from "@/lib/stripe/subscription";
import { checkAiRateLimit } from "@/lib/ai/rate-limit";

/**
 * Shared gate for AI generation routes. Protects the AI provider key by:
 *  1. Enforcing a per-user rate limit (rolling hour + day windows).
 *  2. Requiring an active/trialing subscription for premium routes.
 *
 * The sample tier's single daily-plan preview is handled separately by
 * canGenerateDailyPlan; pass requirePremium: false there.
 *
 * Returns a NextResponse to short-circuit the route, or null to continue.
 */
export async function guardAiRoute(
  userId: string,
  opts: { requirePremium: boolean }
): Promise<NextResponse | null> {
  if (opts.requirePremium) {
    const sub = await getUserSubscriptionStatus(userId);
    if (!sub.isPremium) {
      return NextResponse.json(
        { error: "premium_required", scope: "ai" },
        { status: 402 }
      );
    }
  }

  const rate = await checkAiRateLimit(userId);
  if (!rate.ok) {
    return NextResponse.json(
      {
        error: "rate_limited",
        scope: rate.scope,
        retryAfterMinutes: rate.retryAfterMinutes,
      },
      { status: 429 }
    );
  }

  return null;
}
