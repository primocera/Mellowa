import "server-only";
import type Stripe from "stripe";

/**
 * MW-02: idempotent, Mellowa-owned Stripe customer creation on a SHARED Stripe
 * account (also serving Scalvya and Frost).
 *
 * Two defects this closes:
 *  1. `stripe.customers.create` had no idempotency key. Stripe does not dedupe
 *     customers by email, so a retry after a failed subscription-link write
 *     minted a SECOND customer for the same user — a silent duplicate-customer
 *     footgun that strands billing history across two records.
 *  2. There was no ownership tag, so nothing on the customer proved it was ours
 *     rather than a Scalvya/Frost customer that happens to share an email.
 *
 * Ownership proof is metadata: `supabase_user_id` AND `app === "mellowa"`. Email
 * is never the proof and is never logged.
 */

/** Product-ownership tag written on every Mellowa Stripe customer. */
export const MELLOWA_APP = "mellowa";

/**
 * Stable, non-PII idempotency key for creating a user's customer. Keyed by the
 * Supabase user id (never email), so a retry after a failed link-write returns
 * the SAME customer within Stripe's 24h idempotency window instead of minting a
 * second. Two concurrent first-checkout requests collapse onto one customer for
 * the same reason.
 */
export function customerIdempotencyKey(userId: string): string {
  return `mellowa_customer_${userId}`;
}

export type CustomerRecovery =
  | { kind: "none" }
  | { kind: "found"; customerId: string }
  | { kind: "multiple"; customerIds: string[] }
  | { kind: "unavailable" };

/**
 * Read-only recovery of an existing Mellowa-owned Stripe customer for this user,
 * for the window AFTER the 24h idempotency key expires (or a link-write that
 * failed long ago). Ownership = `metadata.supabase_user_id` AND
 * `metadata.app === "mellowa"`; a foreign (Scalvya/Frost) customer sharing an
 * email is never returned. Deleted customers are excluded.
 *
 * Outcomes are explicit and fail closed:
 *  - `none`         → safe to create a new customer.
 *  - `found`        → reuse it, do not create.
 *  - `multiple`     → do NOT guess which duplicate to charge; caller must fail
 *                     closed and emit a reconciliation signal.
 *  - `unavailable`  → the lookup itself failed; caller must fail closed rather
 *                     than fall through to creating a customer it could not
 *                     prove was absent.
 */
export async function findMellowaCustomer(
  stripe: Stripe,
  userId: string
): Promise<CustomerRecovery> {
  const query = `metadata['supabase_user_id']:'${userId}' AND metadata['app']:'${MELLOWA_APP}'`;
  let result: Stripe.ApiSearchResult<Stripe.Customer>;
  try {
    result = await stripe.customers.search({ query, limit: 10 });
  } catch {
    return { kind: "unavailable" };
  }
  // Stripe search does not return deleted customers, but guard defensively so a
  // deleted record can never be reused as a live one.
  const live = result.data.filter(
    (c) => !(c as { deleted?: boolean }).deleted
  );
  if (live.length === 0) return { kind: "none" };
  if (live.length === 1) return { kind: "found", customerId: live[0].id };
  return { kind: "multiple", customerIds: live.map((c) => c.id) };
}
