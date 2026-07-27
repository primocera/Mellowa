import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { deliverEmail } from "@/lib/email/deliver";
import {
  trialStartedEmail,
  trialEndedEmail,
  paymentFailedEmail,
  paymentRecoveredEmail,
} from "@/lib/email/templates";
import {
  factsFromSubscription,
  factsFromInvoice,
} from "@/lib/email/billing-facts";
import { trackEvent } from "@/lib/analytics";
import type { AnalyticsProperties } from "@/lib/analytics/taxonomy";
import {
  experimentProperty,
  isTrialVariant,
  trialDaysFromDates,
  type TrialVariant,
} from "@/lib/stripe/trial-experiment";

/**
 * Stripe webhook — keeps the subscriptions table in sync (Prompt 14).
 *
 * Idempotency & replay safety:
 *   - Every event is claimed via `claim_stripe_event`. Already-processed
 *     events short-circuit with a 200 (duplicate), so lifecycle emails and
 *     entitlement writes never run twice.
 *   - If an event cannot be mapped to a user (or throws), we mark it failed
 *     and return a non-2xx so Stripe retries. We never silently ack.
 *
 * Local testing:
 *   stripe listen --forward-to localhost:3000/api/stripe/webhook
 *   stripe trigger checkout.session.completed
 */

class RetryableError extends Error {}

export async function POST(request: Request) {
  const stripe = getStripe();

  // Raw body is required for signature verification
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      serverEnv.stripeWebhookSecret
    );
  } catch (err) {
    console.error("[stripe] webhook signature verification failed", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Claim the event atomically. `false` → already done or being processed.
  const { data: claimed, error: claimError } = await admin.rpc(
    "claim_stripe_event",
    { p_event_id: event.id, p_type: event.type }
  );
  if (claimError) {
    console.error("[stripe] could not claim event", {
      event: event.id,
      message: claimError.message,
    });
    // Transient DB issue — let Stripe retry.
    return NextResponse.json({ error: "claim_failed" }, { status: 500 });
  }
  if (!claimed) {
    // Duplicate / replay of an already-processed event. Ack without redoing.
    return NextResponse.json({ received: true, duplicate: true });
  }

  async function finalize(status: "done" | "failed", lastError?: string) {
    await admin
      .from("stripe_events")
      .update({
        status,
        processed_at: new Date().toISOString(),
        last_error: lastError ?? null,
      })
      .eq("event_id", event.id);
  }

  // Resolve a user's email (from Supabase auth) to send lifecycle mail.
  async function emailForCustomer(
    subscription: Stripe.Subscription
  ): Promise<string | null> {
    let userId = subscription.metadata?.supabase_user_id ?? null;
    if (!userId) {
      const customerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id;
      const { data } = await admin
        .from("subscriptions")
        .select("user_id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();
      userId = data?.user_id ?? null;
    }
    if (!userId) return null;
    const { data } = await admin.auth.admin.getUserById(userId);
    return data.user?.email ?? null;
  }

  async function userIdForCustomerId(customerId: string): Promise<string | null> {
    const { data } = await admin
      .from("subscriptions")
      .select("user_id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    return data?.user_id ?? null;
  }

  function intervalOf(subscription: Stripe.Subscription): AnalyticsProperties {
    const priceId = subscription.items.data[0]?.price.id;
    if (priceId === serverEnv.stripePriceProYearly)
      return { surface: "billing", plan_interval: "yearly" };
    if (priceId === serverEnv.stripePriceProMonthly)
      return { surface: "billing", plan_interval: "monthly" };
    return { surface: "billing" };
  }

  /**
   * MW-V10-02: the trial-length cohort for this subscription. Stripe metadata
   * is untrusted input even on a signature-verified event, so the code is
   * accepted only if it is in the app's allowlist; otherwise we fall back to
   * the variant already pinned on the user's row.
   */
  async function variantForSubscription(
    subscription: Stripe.Subscription,
    customerId: string
  ): Promise<TrialVariant | null> {
    const fromMetadata = subscription.metadata?.trial_variant;
    if (isTrialVariant(fromMetadata)) return fromMetadata;
    return variantForCustomerId(customerId);
  }

  /** Cohort read back from the pinned row, for events with no subscription object. */
  async function variantForCustomerId(
    customerId: string
  ): Promise<TrialVariant | null> {
    const { data } = await admin
      .from("subscriptions")
      .select("trial_variant")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    return isTrialVariant(data?.trial_variant) ? data.trial_variant : null;
  }

  /** Interval + trial cohort, the two dimensions every billing event carries. */
  async function billingProps(
    subscription: Stripe.Subscription
  ): Promise<AnalyticsProperties> {
    const customerId =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer.id;
    return {
      ...intervalOf(subscription),
      ...experimentProperty(await variantForSubscription(subscription, customerId)),
    };
  }

  async function emailForCustomerId(customerId: string): Promise<string | null> {
    const { data } = await admin
      .from("subscriptions")
      .select("user_id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    if (!data?.user_id) return null;
    const { data: userData } = await admin.auth.admin.getUserById(data.user_id);
    return userData.user?.email ?? null;
  }

  async function syncSubscription(subscription: Stripe.Subscription) {
    const userId = subscription.metadata?.supabase_user_id;
    const customerId =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer.id;

    // Resolve the user either from metadata or from the stored customer id
    let targetUserId = userId ?? null;
    if (!targetUserId) {
      const { data } = await admin
        .from("subscriptions")
        .select("user_id")
        .eq("stripe_customer_id", customerId)
        .maybeSingle();
      targetUserId = data?.user_id ?? null;
    }
    if (!targetUserId) {
      /*
       * Two very different situations reach this point, and treating them the
       * same is dangerous.
       *
       * 1. A race: our checkout row has not been written yet. Retryable — the
       *    next delivery resolves it. This is what the throw below is for.
       *
       * 2. The subscription belongs to a DIFFERENT PRODUCT on the same Stripe
       *    account. This account also serves Scalvya and Frost, and Stripe
       *    broadcasts every event to every enabled endpoint — it has no notion
       *    of which product an event "belongs" to. Retrying those forever is
       *    actively harmful: Stripe disables endpoints that keep failing, and a
       *    disabled Mellowa endpoint means paying users silently never get
       *    access. That is the "paid but no access" failure v10 fixed, arriving
       *    through a different door.
       *
       * Every subscription we create carries `metadata.supabase_user_id`
       * (set in the checkout route), so its absence — combined with no matching
       * stored customer — means the subscription is provably not ours. Ack it
       * and move on. The race in case 1 still throws, because a Mellowa
       * subscription always has that metadata from the moment it is created.
       *
       * The real fix is a separate Stripe account per product. This keeps one
       * product's traffic from disabling another's webhook until then.
       */
      if (!userId) {
        console.info("[stripe] ignoring subscription from another product", {
          subscription: subscription.id,
          reason: "no supabase_user_id metadata and no matching customer",
        });
        return { ignored: true as const };
      }
      // Ours by metadata, but the row is not written yet — retry.
      throw new RetryableError(`unmapped subscription ${subscription.id}`);
    }

    const item = subscription.items.data[0];
    const periodEnd = item?.current_period_end;
    const priceId = item?.price.id;
    // An unrecognized price is a configuration error — never silently treat
    // it as monthly. The event is marked failed and stays visible to ops.
    let planName: "pro_monthly" | "pro_yearly";
    if (priceId === serverEnv.stripePriceProYearly) {
      planName = "pro_yearly";
    } else if (priceId === serverEnv.stripePriceProMonthly) {
      planName = "pro_monthly";
    } else {
      throw new Error(
        `configuration error: unknown Stripe price ${priceId ?? "<missing>"} on subscription ${subscription.id}`
      );
    }

    const toIso = (unix: number | null | undefined) =>
      unix ? new Date(unix * 1000).toISOString() : null;

    // Existing row for trial-lock preservation and out-of-order guarding.
    const { data: existing } = await admin
      .from("subscriptions")
      .select(
        "trial_used_at, first_trial_subscription_id, current_period_end, last_stripe_event_created, trial_variant, trial_days"
      )
      .eq("user_id", targetUserId)
      .maybeSingle();

    // Out-of-order protection (Prompt 3): Stripe can deliver events out of
    // order, so we apply syncs strictly by the event's `created` timestamp.
    // An event older than the last applied one is ignored for every state
    // transition — period_end comparison alone is not sufficient.
    const nextPeriodEnd = toIso(periodEnd);
    if (
      typeof existing?.last_stripe_event_created === "number" &&
      event.created < existing.last_stripe_event_created
    ) {
      return;
    }

    const hasTrial = subscription.trial_start != null;

    // MW-V10-02: record what Stripe actually granted. The webhook is the first
    // point at which the real trial window is known, so the stored day count
    // becomes Stripe's truth rather than what we asked for. It is only ever
    // written when a trial exists — an existing pinned value is never cleared,
    // because it is the number the user was already shown.
    const metadataVariant = subscription.metadata?.trial_variant;
    const pinnedVariant = isTrialVariant(metadataVariant)
      ? metadataVariant
      : isTrialVariant(existing?.trial_variant)
        ? existing.trial_variant
        : null;
    const grantedTrialDays = hasTrial
      ? trialDaysFromDates(
          toIso(subscription.trial_start),
          toIso(subscription.trial_end)
        )
      : null;

    const { error } = await admin.from("subscriptions").upsert(
      {
        user_id: targetUserId,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscription.id,
        plan_name: planName,
        status: subscription.status,
        current_period_end: nextPeriodEnd,
        trial_start: toIso(subscription.trial_start),
        trial_end: toIso(subscription.trial_end),
        cancel_at_period_end: subscription.cancel_at_period_end ?? false,
        last_stripe_event_created: event.created,
        trial_used_at:
          existing?.trial_used_at ??
          (hasTrial ? toIso(subscription.trial_start) : null),
        first_trial_subscription_id:
          existing?.first_trial_subscription_id ??
          (hasTrial ? subscription.id : null),
        trial_variant: pinnedVariant,
        trial_days: grantedTrialDays ?? existing?.trial_days ?? null,
      },
      { onConflict: "user_id" }
    );
    if (error) throw new RetryableError(`subscriptions upsert: ${error.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode === "subscription" && session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id
          );
          if ((await syncSubscription(subscription))?.ignored) break;
          const uid = await userIdForCustomerId(
            typeof subscription.customer === "string"
              ? subscription.customer
              : subscription.customer.id
          );
          trackEvent("checkout_completed", {
            userId: uid,
            properties: await billingProps(subscription),
          });
        }
        break;
      }
      case "customer.subscription.created": {
        const subscription = event.data.object;
        // Not ours (another product on this shared Stripe account): stop here
        // rather than tracking analytics or acting on someone else's customer.
        if ((await syncSubscription(subscription))?.ignored) break;
        if (subscription.status === "trialing") {
          trackEvent("trial_started", {
            userId: await userIdForCustomerId(
              typeof subscription.customer === "string"
                ? subscription.customer
                : subscription.customer.id
            ),
            properties: await billingProps(subscription),
          });
          const email = await emailForCustomer(subscription);
          if (email) {
            // The email states the length Stripe actually granted, so a 7-day
            // cohort never receives 3-day wording (or the reverse).
            const { subject, html } = trialStartedEmail(
              factsFromSubscription(subscription, "trial_end"),
              trialDaysFromDates(
                subscription.trial_start
                  ? new Date(subscription.trial_start * 1000).toISOString()
                  : null,
                subscription.trial_end
                  ? new Date(subscription.trial_end * 1000).toISOString()
                  : null
              )
            );
            await deliverEmail({
              eventKey: `trial_started:${subscription.id}`,
              template: "trial_started",
              to: email,
              subject,
              html,
            });
          }
        }
        break;
      }
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        // Not ours (another product on this shared Stripe account): stop here
        // rather than tracking analytics or acting on someone else's customer.
        if ((await syncSubscription(subscription))?.ignored) break;
        const prev = event.data.previous_attributes as
          | Partial<Stripe.Subscription>
          | undefined;
        if (prev?.status === "trialing" && subscription.status === "active") {
          trackEvent("trial_converted", {
            userId: await userIdForCustomerId(
              typeof subscription.customer === "string"
                ? subscription.customer
                : subscription.customer.id
            ),
            properties: await billingProps(subscription),
          });
          const email = await emailForCustomer(subscription);
          if (email) {
            const { subject, html } = trialEndedEmail();
            await deliverEmail({
              eventKey: `trial_ended:${subscription.id}`,
              template: "trial_ended",
              to: email,
              subject,
              html,
            });
          }
        }
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        // Not ours (another product on this shared Stripe account): stop here
        // rather than tracking analytics or acting on someone else's customer.
        if ((await syncSubscription(subscription))?.ignored) break;
        // Voluntary vs involuntary churn (Prompt 18): a subscription the user
        // set to cancel ended voluntarily; one Stripe ended after failed
        // payment retries (past_due/unpaid) ended involuntarily.
        const churnType =
          subscription.cancel_at_period_end ||
          subscription.cancellation_details?.reason === "cancellation_requested"
            ? "voluntary"
            : "involuntary";
        trackEvent("trial_canceled", {
          userId: await userIdForCustomerId(
            typeof subscription.customer === "string"
              ? subscription.customer
              : subscription.customer.id
          ),
          properties: {
            ...(await billingProps(subscription)),
            churn_type: churnType,
          },
        });
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const customerId =
          typeof invoice.customer === "string"
            ? invoice.customer
            : invoice.customer?.id;
        if (customerId) {
          await admin
            .from("subscriptions")
            .update({ status: "past_due" })
            .eq("stripe_customer_id", customerId);
          trackEvent("payment_failed", {
            userId: await userIdForCustomerId(customerId),
            properties: { surface: "billing", outcome: "failure" },
          });
          const email = await emailForCustomerId(customerId);
          if (email) {
            const { subject, html } = paymentFailedEmail(
              factsFromInvoice(invoice)
            );
            await deliverEmail({
              eventKey: `payment_failed:${invoice.id}`,
              template: "payment_failed",
              to: email,
              subject,
              html,
            });
          }
        }
        break;
      }
      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        const customerId =
          typeof invoice.customer === "string"
            ? invoice.customer
            : invoice.customer?.id;
        if (customerId) {
          const { data: recovered } = await admin
            .from("subscriptions")
            .update({ status: "active" })
            .eq("stripe_customer_id", customerId)
            .eq("status", "past_due")
            .select("user_id");
          const uid = await userIdForCustomerId(customerId);
          // A past_due row that just went active is a dunning recovery; a
          // clean paid invoice is a renewal. Distinguish the two truthfully.
          if (recovered && recovered.length > 0) {
            trackEvent("payment_recovered", {
              userId: uid,
              properties: { surface: "billing", outcome: "success" },
            });
            const email = await emailForCustomerId(customerId);
            if (email) {
              const { subject, html } = paymentRecoveredEmail();
              await deliverEmail({
                eventKey: `payment_recovered:${invoice.id}`,
                userId: uid,
                template: "payment_recovered",
                to: email,
                subject,
                html,
              });
            }
          } else if (invoice.billing_reason === "subscription_cycle") {
            trackEvent("subscription_renewed", {
              userId: uid,
              properties: {
                surface: "billing",
                outcome: "success",
                // Renewal is the outcome the trial-length experiment is judged
                // on, so it carries the cohort like the trial events do.
                ...experimentProperty(await variantForCustomerId(customerId)),
              },
            });
          }
        }
        break;
      }
      // A refund does not itself end a subscription — Stripe emits a separate
      // subscription event when it does. Recording it keeps the owner-run
      // refund step of the launch rehearsal observable in the same place as
      // the rest of billing, instead of only in the Stripe dashboard.
      case "charge.refunded": {
        const charge = event.data.object;
        const customerId =
          typeof charge.customer === "string"
            ? charge.customer
            : charge.customer?.id;
        if (customerId) {
          trackEvent("payment_refunded", {
            userId: await userIdForCustomerId(customerId),
            // The refund itself succeeded either way; the taxonomy has no
            // "partial" outcome and inventing one would break the contract.
            // Amounts stay in Stripe, which is the source of truth for money.
            properties: { surface: "billing", outcome: "success" },
          });
        }
        break;
      }
      // A dispute is a trust and cash event that needs an owner, not an
      // automated entitlement change: never revoke access from code here.
      case "charge.dispute.created": {
        const dispute = event.data.object;
        const charge =
          typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
        console.warn("[stripe] dispute opened — owner action required", {
          charge,
        });
        trackEvent("payment_disputed", {
          properties: { surface: "billing", outcome: "failure" },
        });
        break;
      }
      default:
        // Unhandled event types are fine — acknowledge them.
        break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    await finalize("failed", message);
    if (err instanceof RetryableError) {
      console.error("[stripe] retryable processing failure", {
        event: event.id,
        message,
      });
      return NextResponse.json({ error: "processing_failed" }, { status: 500 });
    }
    console.error("[stripe] webhook handler error", { event: event.id, message });
    return NextResponse.json({ error: "handler_error" }, { status: 500 });
  }

  await finalize("done");
  return NextResponse.json({ received: true });
}
