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

/**
 * MW-95-01: outcome of proving a specific Stripe customer id is owned by THIS
 * Mellowa user. `findMellowaCustomer` searches for a customer we don't have an
 * id for; this verifies a customer id we already hold (from the stored
 * subscription row, a concurrent-race winner, or a fresh create/recover) before
 * it is ever handed to Checkout or the Billing Portal.
 *
 *  - `owned`        → metadata proves it; safe to use.
 *  - `mismatch`     → a LIVE customer whose metadata does not prove ownership
 *                     (foreign app, wrong user, or missing tags). Fail closed
 *                     and reconcile — never charge or auto-repair it.
 *  - `missing`      → the id resolves to nothing chargeable (`resource_missing`
 *                     or a deleted customer). Safe to fall through to orphan
 *                     recovery (search → reuse/create → relink).
 *  - `unavailable`  → the retrieve itself failed transiently; fail closed and
 *                     let the caller retry rather than assume anything.
 */
export type CustomerOwnership =
  | { kind: "owned"; customerId: string }
  | { kind: "mismatch" }
  | { kind: "missing" }
  | { kind: "unavailable" };

/**
 * Retrieve a customer id and prove Mellowa ownership by EXACT metadata:
 * `metadata.app === "mellowa"` AND `metadata.supabase_user_id === userId`.
 * Presence of the id in Mellowa's subscriptions table is never proof — on a
 * shared Stripe account the row could point at a foreign or wrong-user
 * customer. Email is never consulted and never logged.
 */
export async function verifyMellowaCustomerOwnership(
  stripe: Stripe,
  customerId: string,
  userId: string
): Promise<CustomerOwnership> {
  let customer: Stripe.Customer | Stripe.DeletedCustomer;
  try {
    customer = await stripe.customers.retrieve(customerId);
  } catch (err) {
    // A genuinely absent customer is a recoverable orphan; anything else is a
    // transient read we must not interpret as ownership either way.
    const code = (err as { code?: string } | null)?.code;
    if (code === "resource_missing") return { kind: "missing" };
    return { kind: "unavailable" };
  }
  // A deleted customer cannot be charged and carries no usable metadata; treat
  // it exactly like `resource_missing` so recovery can converge on a live one.
  if ((customer as { deleted?: boolean }).deleted) return { kind: "missing" };
  const metadata = (customer as Stripe.Customer).metadata ?? {};
  if (
    metadata.app === MELLOWA_APP &&
    metadata.supabase_user_id === userId
  ) {
    return { kind: "owned", customerId: customer.id };
  }
  // Live, but not provably ours: foreign app, wrong user, or missing tags.
  return { kind: "mismatch" };
}
