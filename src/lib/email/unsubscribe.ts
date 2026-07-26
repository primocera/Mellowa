import { createHmac, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";

/**
 * Signed one-click unsubscribe links (MW-V10-00).
 *
 * Reminder email must carry a working opt-out that does NOT require signing
 * in — the recipient is often on a phone, logged out, and a link that lands on
 * a login wall is not an unsubscribe. The token is an HMAC over the user id and
 * the email category, so it grants exactly one capability (stop this category
 * for this user) and nothing else: it cannot read, authenticate or mutate
 * anything, and it carries no personal data in the URL.
 *
 * Transactional billing/account mail is deliberately NOT unsubscribable — it is
 * service correspondence about money the user is paying, and silently
 * suppressing it would be worse than sending it.
 */

/** Categories a recipient may switch off. Reminders only, by design. */
export type UnsubscribeCategory = "daily_reminder" | "onboarding_nudge";

const CATEGORIES: readonly UnsubscribeCategory[] = [
  "daily_reminder",
  "onboarding_nudge",
];

export function isUnsubscribeCategory(v: string): v is UnsubscribeCategory {
  return (CATEGORIES as readonly string[]).includes(v);
}

/**
 * Signing key. Falls back to CRON_SECRET so no new required env is introduced;
 * returns null when neither is set, which makes the caller fail closed rather
 * than mint forgeable links.
 */
function signingKey(): string | null {
  return process.env.EMAIL_UNSUBSCRIBE_SECRET ?? serverEnv.cronSecret ?? null;
}

function sign(userId: string, category: UnsubscribeCategory, key: string): string {
  return createHmac("sha256", key)
    .update(`${userId}:${category}`)
    .digest("base64url");
}

export function unsubscribeToken(
  userId: string,
  category: UnsubscribeCategory
): string | null {
  const key = signingKey();
  return key ? sign(userId, category, key) : null;
}

export function verifyUnsubscribeToken(
  userId: string,
  category: UnsubscribeCategory,
  token: string
): boolean {
  const key = signingKey();
  if (!key || !token) return false;
  const expected = Buffer.from(sign(userId, category, key));
  const provided = Buffer.from(token);
  // Length check first: timingSafeEqual throws on a length mismatch.
  return (
    expected.length === provided.length && timingSafeEqual(expected, provided)
  );
}

/**
 * Absolute unsubscribe URL for an email footer and the List-Unsubscribe
 * header. Returns null when no signing key is configured — callers must then
 * omit the link rather than render a broken one.
 */
export function unsubscribeUrl(
  userId: string,
  category: UnsubscribeCategory
): string | null {
  const token = unsubscribeToken(userId, category);
  if (!token) return null;
  const params = new URLSearchParams({ u: userId, c: category, t: token });
  return `${serverEnv.appUrl}/api/email/unsubscribe?${params.toString()}`;
}
