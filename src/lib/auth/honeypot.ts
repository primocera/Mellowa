/**
 * Honeypot for the public auth forms. Pure module (client + server).
 *
 * The forms render a text input with this innocuous name, positioned off-screen
 * (not display:none, which some bots skip), aria-hidden and out of the tab
 * order, so a person never fills it. A request that arrives with it filled is
 * answered with the exact same generic success the real path returns, and
 * nothing is created, sent or counted.
 */
export const HONEYPOT_FIELD = "company_website";

/** True when the honeypot was filled in. */
export function honeypotTripped(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const value = (body as Record<string, unknown>)[HONEYPOT_FIELD];
  if (value == null || value === false) return false;
  return typeof value === "string" ? value.trim().length > 0 : true;
}
