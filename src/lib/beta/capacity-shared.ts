/**
 * MW-V10-06: beta-gate facts that BOTH the browser and the server need.
 *
 * Split from `capacity.ts` (which is `server-only`) because the signup form is
 * a client component and has to recognise the gate's error to show honest copy.
 * Only codes and copy live here — never the capacity numbers, which the client
 * has no business knowing.
 */

/** Stable codes raised by the database trigger. Never shown to a user raw. */
export const BETA_CLOSED_CODE = "beta_signups_closed";
export const BETA_FULL_CODE = "beta_capacity_reached";

/**
 * Whether a Supabase auth error is the beta gate rejecting the signup.
 * Supabase wraps trigger exceptions, so the code is matched inside the message
 * rather than compared exactly.
 */
export function isBetaGateError(message: string | null | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return m.includes(BETA_CLOSED_CODE) || m.includes(BETA_FULL_CODE);
}

/**
 * What a would-be user is told. Deliberately identical for "closed" and
 * "full": how close the beta is to capacity is not their business, and a
 * countdown would manufacture the kind of urgency the product contract
 * forbids. It states that nothing was created, so nobody is left wondering
 * whether a half-account exists.
 */
export const BETA_CLOSED_MESSAGE =
  "Mellowa is in a small closed beta and isn't taking new accounts right now. Nothing was created, and no card was involved.";
