/**
 * Canonical route → primary-hub resolver (MW-95-04).
 *
 * The four primary destinations are Today, Week, Saved and You. Every
 * authenticated detail route belongs to exactly one of them, so a deep link or a
 * refresh on `/weekly-plan` or `/billing` still lights the right parent. Active
 * state used to be `pathname.startsWith(hub.href)`, which left every detail route
 * with no active hub (none of them start with `/today`, `/plan`, `/library` or
 * `/you`). This is the single source of that mapping — desktop nav, mobile nav
 * and the tests all import it, so the three can never drift.
 *
 * Pure module: no React, no server-only imports, so a table-driven unit test and
 * both client nav variants can load it directly.
 */

export type Hub = "today" | "week" | "saved" | "you";

/** The primary destination each hub links to. */
export const HUB_HREF: Record<Hub, string> = {
  today: "/today",
  week: "/plan",
  saved: "/library",
  you: "/you",
};

/**
 * Explicit route → hub assignments, by user job (not by which generator built
 * the page). One canonical parent per route; a route reachable from more than one
 * hub still has exactly one *active* parent here, and the non-canonical entry
 * uses breadcrumbs/back links rather than history to preserve context.
 *
 *  - Today: the daily home and its contextual check-in.
 *  - Week:  weekly planning, with meal rhythm as the canonical planning context.
 *  - Saved: reusable library — favourites, movement and calm-reset reuse.
 *  - You:   preferences, patterns/progress, journal, habits, billing, help,
 *           settings and privacy.
 */
const ROUTE_HUB: Record<string, Hub> = {
  "/today": "today",
  "/check-in": "today",
  "/dashboard": "today",
  "/plan": "week",
  "/weekly-plan": "week",
  "/meal-rhythm": "week",
  "/library": "saved",
  "/favourites": "saved",
  "/movement": "saved",
  "/stress-reset": "saved",
  "/you": "you",
  "/progress": "you",
  "/journal": "you",
  "/habits": "you",
  "/billing": "you",
  "/settings": "you",
  "/help": "you",
};

/** Prefixes sorted longest-first, so the most specific route wins. */
const SORTED_PREFIXES = Object.keys(ROUTE_HUB).sort((a, b) => b.length - a.length);

/**
 * Normalize a pathname: drop the query string and hash, strip a trailing slash
 * (except root). Query and hash never change the parent hub.
 */
function normalizePath(pathname: string): string {
  let p = pathname.split("?")[0].split("#")[0];
  if (p.length > 1 && p.endsWith("/")) p = p.replace(/\/+$/, "");
  return p;
}

/**
 * Resolve the active hub for a pathname, or `null` for an unknown authenticated
 * route (which must highlight NO hub — a false active parent is worse than none).
 * Longest/most-specific match wins; a route matches a prefix only on an exact
 * match or a `/`-delimited descendant, so `/plannable` never matches `/plan`.
 */
export function hubForPath(pathname: string): Hub | null {
  const path = normalizePath(pathname);
  for (const prefix of SORTED_PREFIXES) {
    if (path === prefix || path.startsWith(prefix + "/")) {
      return ROUTE_HUB[prefix];
    }
  }
  return null;
}

/** All routes explicitly mapped — used by the table-driven test. */
export const MAPPED_ROUTES = Object.keys(ROUTE_HUB);
