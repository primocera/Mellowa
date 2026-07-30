/**
 * Ordering guard for Stripe webhook processing (MW-V12-03).
 *
 * Stripe guarantees neither the order nor exactly-once delivery of webhook
 * events. A failed delivery is retried, so an `invoice.payment_failed` can land
 * *after* the `invoice.payment_succeeded` that recovered it — and if the handler
 * trusts arrival order, it drags a paying customer back to `past_due` and
 * silently removes their access. That is the specific residual risk recorded
 * against P0-LIVE-TRANSACTION.
 *
 * The cure is to apply state transitions in the event's own `created` order,
 * not the order they happen to arrive. Every subscription row carries
 * `last_stripe_event_created` — the `created` timestamp of the newest event
 * already applied to it. A new event is applied only if it is at least as new.
 *
 * Pure and dependency-free so the webhook's ordering logic can be unit-tested
 * directly, including the late-failure-after-recovery case that has no other
 * home in the suite.
 */

/**
 * Should an event with this `created` timestamp be applied over a row whose
 * newest applied event was `lastApplied`?
 *
 * `null`/`undefined` means nothing has been applied yet, so anything applies.
 * Equal timestamps apply (Stripe `created` is whole seconds, so two events in
 * the same second are treated as concurrent and the later arrival wins — which
 * is harmless, because same-second billing transitions do not contradict each
 * other in practice).
 */
export function shouldApplyStripeEvent(
  created: number,
  lastApplied: number | null | undefined,
): boolean {
  if (lastApplied == null) return true;
  return created >= lastApplied;
}
