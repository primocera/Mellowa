/**
 * MW-04: one explicit result for "what does our billing system say about this
 * user?", so a null row (verified: this account has no subscription) is never
 * confused with a read that failed (we could not verify anything).
 *
 * The bug this closes: `const { data } = await supabase...maybeSingle()` throws
 * the Supabase `error` away, so a failed read looks identical to "no row". At
 * checkout that offers an existing payer a second trial; on a pricing page it
 * promises a trial the account may not be eligible for; on a quota read it
 * grants a free generation. Every caller must fail CLOSED on `unavailable`:
 * no Stripe mutation, no trial promise, no extra free generation.
 */

export type BillingState = "verified_none" | "verified_subscription" | "unavailable";

export interface BillingLookup<Row> {
  state: BillingState;
  /** The row when state is `verified_subscription`; null otherwise. */
  row: Row | null;
}

/** The shape of a Supabase error object, narrowed to what we may log. */
interface SupabaseErrorLike {
  code?: string | null;
  message?: string | null;
}

/**
 * Classify a Supabase `maybeSingle()` result into an explicit billing state.
 * `error` present -> unavailable (never trusted as "no subscription").
 * `data` null/undefined with no error -> verified_none.
 * `data` present -> verified_subscription.
 */
export function classifyBillingRead<Row>(
  data: Row | null | undefined,
  error: SupabaseErrorLike | null | undefined
): BillingLookup<Row> {
  if (error) return { state: "unavailable", row: null };
  if (data == null) return { state: "verified_none", row: null };
  return { state: "verified_subscription", row: data };
}
