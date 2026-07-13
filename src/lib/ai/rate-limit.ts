import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * AI generation rate limiting — protects the AI provider key from abuse.
 * Backed by ai_usage_events (see migration 004). Limits are per user, counted
 * over rolling windows. These are generous for genuine daily use but stop a
 * single account from hammering the provider.
 */
export const AI_RATE_LIMITS = {
  perHour: 15,
  perDay: 40,
} as const;

export type AiRoute =
  | "daily-plan"
  | "weekly-plan"
  | "meal-rhythm"
  | "habit-plan"
  | "journal-reflection"
  | "regenerate-section";

export interface RateLimitResult {
  ok: boolean;
  scope?: "hour" | "day";
  retryAfterMinutes?: number;
}

async function countSince(userId: string, sinceIso: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("ai_usage_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", sinceIso);
  return count ?? 0;
}

/**
 * Check whether the user may make another AI call right now.
 * Call this BEFORE generation. Log usage with recordAiUsage AFTER a successful
 * generation so failed provider calls don't consume the quota.
 */
export async function checkAiRateLimit(
  userId: string
): Promise<RateLimitResult> {
  const now = Date.now();
  const hourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  const [hourCount, dayCount] = await Promise.all([
    countSince(userId, hourAgo),
    countSince(userId, dayAgo),
  ]);

  if (hourCount >= AI_RATE_LIMITS.perHour) {
    return { ok: false, scope: "hour", retryAfterMinutes: 60 };
  }
  if (dayCount >= AI_RATE_LIMITS.perDay) {
    return { ok: false, scope: "day", retryAfterMinutes: 24 * 60 };
  }
  return { ok: true };
}

/** Record a successful AI generation for rate-limit accounting. */
export async function recordAiUsage(
  userId: string,
  route: AiRoute
): Promise<void> {
  const supabase = await createClient();
  await supabase.from("ai_usage_events").insert({ user_id: userId, route });
}
