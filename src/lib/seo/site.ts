/**
 * Canonical public site origin for SEO/social metadata (Launch v6, Prompt 23).
 * Pure module — safe for client, server, route handlers and tests.
 *
 * Uses NEXT_PUBLIC_APP_URL when set; falls back to the production domain so a
 * build without the env still emits correct canonical/OG URLs rather than
 * localhost. Trailing slash is stripped for stable joins.
 */
const RAW = process.env.NEXT_PUBLIC_APP_URL || "https://mellowa.app";

export const SITE_URL = RAW.replace(/\/+$/, "");

/** Public, indexable pages. Everything else is private or an API path. */
export const PUBLIC_ROUTES = [
  "/",
  "/pricing",
  "/privacy",
  "/terms",
  "/refund",
  "/login",
  "/signup",
] as const;

/**
 * Route prefixes that must never be indexed: authenticated app surfaces,
 * admin, auth callbacks and all API paths. Used by robots.
 */
export const PRIVATE_PREFIXES = [
  "/api/",
  "/today",
  "/check-in",
  "/week",
  "/library",
  "/patterns",
  "/you",
  "/billing",
  "/settings",
  "/onboarding",
  "/admin",
  "/auth/",
] as const;

export function canonical(path = "/"): string {
  return `${SITE_URL}${path === "/" ? "" : path}`;
}
