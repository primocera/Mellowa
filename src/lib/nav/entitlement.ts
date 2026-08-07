/**
 * Coarse billing category for navigation analytics (MW-V9-01, MW-95-04).
 *
 * Pure module so both the app layout and a unit test can load it without pulling
 * in server-only billing code. It carries a COARSE category only — never a user
 * id, plan content or check-in signal.
 */

export type NavEntitlement =
  | "free"
  | "trialing"
  | "premium"
  | "past_due"
  | "canceled"
  | "unknown";

/**
 * MW-95-04: a billing READ that could not be verified must never be recorded as
 * "free". `getUserSubscriptionStatus` forces `status` to "none" on a failed read
 * (fail-closed for entitlement), which is indistinguishable from a genuinely
 * non-entitled user — so branch on `billing` first and map an unavailable or
 * unrecognized state to "unknown". "free" is reserved for a CONFIRMED
 * non-entitled state ("none" on a successful read), so a billing outage stays
 * visible in operational metrics instead of being understated as free users.
 */
export function navEntitlement(
  status: string,
  billing: "available" | "unavailable"
): NavEntitlement {
  if (billing === "unavailable") return "unknown";
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "premium";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
      return "canceled";
    case "none":
      return "free";
    default:
      // An unrecognized status is not a confirmed free user.
      return "unknown";
  }
}
