/**
 * Funnel-intent helpers for the signup → verify-email → callback flow
 * (Launch audit v6, Prompt 1).
 *
 * The selected plan interval and post-auth destination must survive email
 * verification without ever allowing an open redirect: the callback route
 * only follows relative paths that match a known-prefix allow-list.
 */

export type PlanIntent = "monthly" | "yearly";

const ALLOWED_NEXT_PREFIXES = [
  "/dashboard",
  "/onboarding",
  "/today",
  "/check-in",
  "/pricing",
  "/billing",
] as const;

export function parsePlanIntent(value: string | null | undefined): PlanIntent | null {
  return value === "monthly" || value === "yearly" ? value : null;
}

/**
 * Returns a safe relative path or null. Rejects absolute URLs,
 * protocol-relative URLs ("//host"), backslash tricks and any path outside
 * the allow-list. Query strings on an allowed path are preserved.
 */
export function sanitizeNextPath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  if (value.includes("\\")) return null;
  if (value.includes("://")) return null;

  const pathOnly = value.split(/[?#]/)[0];
  const allowed = ALLOWED_NEXT_PREFIXES.some(
    (p) => pathOnly === p || pathOnly.startsWith(`${p}/`)
  );
  if (!allowed) return null;

  // Drop any #fragment; keep the query string.
  const hashIndex = value.indexOf("#");
  return hashIndex === -1 ? value : value.slice(0, hashIndex);
}

/** Serializes plan/next into a query string ("" when nothing to carry). */
export function serializeIntent(intent: {
  plan?: PlanIntent | null;
  next?: string | null;
}): string {
  const params = new URLSearchParams();
  if (intent.plan) params.set("plan", intent.plan);
  const next = sanitizeNextPath(intent.next);
  if (next) params.set("next", next);
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** Resolves the post-verification destination, defaulting to /dashboard. */
export function resolveDestination(intent: {
  plan?: PlanIntent | null;
  next?: string | null;
}): string {
  const next = sanitizeNextPath(intent.next);
  if (next) return next;
  if (intent.plan) return `/pricing?plan=${intent.plan}`;
  return "/dashboard";
}
