import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

/**
 * Billing reconciliation (Launch v6, Prompt 18).
 *
 * Stripe is the source of truth for subscription state; the local
 * `subscriptions` row is the entitlement cache the app reads. Webhooks keep
 * them in sync in real time; this job catches anything they missed (dropped
 * webhook, deploy gap, manual dashboard change) and reports operator-visible
 * exceptions instead of letting drift rot silently.
 */

export interface LocalSubRow {
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan_name: string | null;
  status: string;
  current_period_end: string | null;
  trial_end: string | null;
  cancel_at_period_end: boolean | null;
}

export interface DriftItem {
  userId: string;
  subscriptionId: string;
  field: "status" | "plan_name" | "current_period_end" | "trial_end" | "cancel_at_period_end";
  local: string | boolean | null;
  stripe: string | boolean | null;
}

export interface ReconcileReport {
  checked: number;
  driftFixed: DriftItem[];
  /** Local rows whose Stripe subscription no longer exists / errored. */
  unresolvable: { userId: string; subscriptionId: string; error: string }[];
  /** Two local users pointing at the same Stripe customer — always a bug. */
  duplicateCustomers: { customerId: string; userIds: string[] }[];
  /** Stripe price ids seen that the env config doesn't know. */
  unknownPrices: string[];
  /** Webhook events failed or stuck in processing for over an hour. */
  stuckWebhookEvents: { eventId: string; type: string; status: string }[];
  ok: boolean;
}

const toIso = (unix: number | null | undefined) =>
  unix ? new Date(unix * 1000).toISOString() : null;

export function planNameForPrice(priceId: string | undefined): string | null {
  if (priceId === serverEnv.stripePriceProYearly) return "pro_yearly";
  if (priceId === serverEnv.stripePriceProMonthly) return "pro_monthly";
  return null;
}

/**
 * Pure comparison of a local row against the live Stripe subscription.
 * Returns the field-level differences (empty array = in sync).
 */
export function diffSubscription(
  local: LocalSubRow,
  stripe: Pick<Stripe.Subscription, "id" | "status" | "cancel_at_period_end" | "trial_end"> & {
    items: { data: { price: { id: string }; current_period_end?: number }[] };
  }
): DriftItem[] {
  const drift: DriftItem[] = [];
  const item = stripe.items.data[0];
  const stripePlan = planNameForPrice(item?.price.id);
  const stripePeriodEnd = toIso(item?.current_period_end);
  const stripeTrialEnd = toIso(stripe.trial_end);
  const base = { userId: local.user_id, subscriptionId: stripe.id };

  if (local.status !== stripe.status) {
    drift.push({ ...base, field: "status", local: local.status, stripe: stripe.status });
  }
  if (stripePlan !== null && local.plan_name !== stripePlan) {
    drift.push({ ...base, field: "plan_name", local: local.plan_name, stripe: stripePlan });
  }
  if ((local.current_period_end ?? null) !== stripePeriodEnd) {
    drift.push({
      ...base,
      field: "current_period_end",
      local: local.current_period_end,
      stripe: stripePeriodEnd,
    });
  }
  if ((local.trial_end ?? null) !== stripeTrialEnd) {
    drift.push({ ...base, field: "trial_end", local: local.trial_end, stripe: stripeTrialEnd });
  }
  if ((local.cancel_at_period_end ?? false) !== (stripe.cancel_at_period_end ?? false)) {
    drift.push({
      ...base,
      field: "cancel_at_period_end",
      local: local.cancel_at_period_end ?? false,
      stripe: stripe.cancel_at_period_end ?? false,
    });
  }
  return drift;
}

/** Pure duplicate-customer detection over the local rows. */
export function findDuplicateCustomers(
  rows: Pick<LocalSubRow, "user_id" | "stripe_customer_id">[]
): ReconcileReport["duplicateCustomers"] {
  const byCustomer = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.stripe_customer_id) continue;
    const list = byCustomer.get(r.stripe_customer_id) ?? [];
    list.push(r.user_id);
    byCustomer.set(r.stripe_customer_id, list);
  }
  return [...byCustomer.entries()]
    .filter(([, userIds]) => userIds.length > 1)
    .map(([customerId, userIds]) => ({ customerId, userIds }));
}

/**
 * Fetch each local subscription from Stripe, fix local drift from Stripe's
 * state, and collect exceptions. Small-scale by design (per-subscription
 * retrieve; fine well past 1k subscribers on a daily cadence).
 */
export async function reconcileBilling(
  stripe: Stripe,
  admin: SupabaseClient
): Promise<ReconcileReport> {
  const report: ReconcileReport = {
    checked: 0,
    driftFixed: [],
    unresolvable: [],
    duplicateCustomers: [],
    unknownPrices: [],
    stuckWebhookEvents: [],
    ok: true,
  };

  const { data: rows, error } = await admin
    .from("subscriptions")
    .select(
      "user_id, stripe_customer_id, stripe_subscription_id, plan_name, status, current_period_end, trial_end, cancel_at_period_end"
    )
    .not("stripe_subscription_id", "is", null);
  if (error) throw new Error(`reconcile: could not read subscriptions: ${error.message}`);

  const locals = (rows ?? []) as LocalSubRow[];
  report.duplicateCustomers = findDuplicateCustomers(locals);

  for (const local of locals) {
    if (!local.stripe_subscription_id) continue;
    report.checked += 1;
    let remote: Stripe.Subscription;
    try {
      remote = await stripe.subscriptions.retrieve(local.stripe_subscription_id);
    } catch (err) {
      report.unresolvable.push({
        userId: local.user_id,
        subscriptionId: local.stripe_subscription_id,
        error: err instanceof Error ? err.message : "unknown",
      });
      continue;
    }

    const priceId = remote.items.data[0]?.price.id;
    if (priceId && planNameForPrice(priceId) === null && !report.unknownPrices.includes(priceId)) {
      report.unknownPrices.push(priceId);
    }

    const drift = diffSubscription(local, remote);
    if (drift.length === 0) continue;

    const item = remote.items.data[0];
    const { error: fixError } = await admin
      .from("subscriptions")
      .update({
        status: remote.status,
        plan_name: planNameForPrice(priceId) ?? local.plan_name,
        current_period_end: toIso(item?.current_period_end),
        trial_end: toIso(remote.trial_end),
        cancel_at_period_end: remote.cancel_at_period_end ?? false,
      })
      .eq("user_id", local.user_id);
    if (fixError) {
      report.unresolvable.push({
        userId: local.user_id,
        subscriptionId: local.stripe_subscription_id,
        error: `fix failed: ${fixError.message}`,
      });
      continue;
    }
    report.driftFixed.push(...drift);
  }

  // Webhook health: failed events, or claimed-but-never-finalized ones.
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: stuck } = await admin
    .from("stripe_events")
    .select("event_id, type, status, created_at")
    .or(`status.eq.failed,and(status.eq.processing,created_at.lt.${hourAgo})`)
    .order("created_at", { ascending: false })
    .limit(50);
  report.stuckWebhookEvents = (stuck ?? []).map((e) => ({
    eventId: e.event_id as string,
    type: e.type as string,
    status: e.status as string,
  }));

  report.ok =
    report.unresolvable.length === 0 &&
    report.duplicateCustomers.length === 0 &&
    report.unknownPrices.length === 0 &&
    report.stuckWebhookEvents.length === 0;
  return report;
}
