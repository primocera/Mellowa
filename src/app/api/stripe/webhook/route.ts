import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { sendEmail } from "@/lib/email/send";
import {
  trialStartedEmail,
  trialEndedEmail,
  paymentFailedEmail,
} from "@/lib/email/templates";

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
      // Cannot map to a user — do NOT ack. Retryable so a race (webhook before
      // the checkout row is written) resolves on Stripe's retry.
      throw new RetryableError(`unmapped subscription ${subscription.id}`);
    }

    const item = subscription.items.data[0];
    const periodEnd = item?.current_period_end;
    const priceId = item?.price.id;
    const planName =
      priceId === serverEnv.stripePriceProYearly ? "pro_yearly" : "pro_monthly";

    const toIso = (unix: number | null | undefined) =>
      unix ? new Date(unix * 1000).toISOString() : null;

    // Existing row for trial-lock preservation and out-of-order guarding.
    const { data: existing } = await admin
      .from("subscriptions")
      .select("trial_used_at, first_trial_subscription_id, current_period_end")
      .eq("user_id", targetUserId)
      .maybeSingle();

    // Out-of-order protection: ignore a stale event whose period end predates
    // what we already stored (Stripe can deliver events out of order).
    const nextPeriodEnd = toIso(periodEnd);
    if (
      existing?.current_period_end &&
      nextPeriodEnd &&
      new Date(nextPeriodEnd) < new Date(existing.current_period_end) &&
      subscription.status !== "canceled"
    ) {
      return;
    }

    const hasTrial = subscription.trial_start != null;

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
        trial_used_at:
          existing?.trial_used_at ??
          (hasTrial ? toIso(subscription.trial_start) : null),
        first_trial_subscription_id:
          existing?.first_trial_subscription_id ??
          (hasTrial ? subscription.id : null),
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
          await syncSubscription(subscription);
        }
        break;
      }
      case "customer.subscription.created": {
        const subscription = event.data.object;
        await syncSubscription(subscription);
        if (subscription.status === "trialing") {
          const email = await emailForCustomer(subscription);
          if (email) {
            const daysLeft = subscription.trial_end
              ? Math.max(
                  1,
                  Math.ceil(
                    (subscription.trial_end * 1000 - Date.now()) /
                      (24 * 60 * 60 * 1000)
                  )
                )
              : 3;
            const { subject, html } = trialStartedEmail(daysLeft);
            await sendEmail({ to: email, subject, html });
          }
        }
        break;
      }
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        await syncSubscription(subscription);
        const prev = event.data.previous_attributes as
          | Partial<Stripe.Subscription>
          | undefined;
        if (prev?.status === "trialing" && subscription.status === "active") {
          const email = await emailForCustomer(subscription);
          if (email) {
            const { subject, html } = trialEndedEmail();
            await sendEmail({ to: email, subject, html });
          }
        }
        break;
      }
      case "customer.subscription.deleted": {
        await syncSubscription(event.data.object);
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
          const email = await emailForCustomerId(customerId);
          if (email) {
            const { subject, html } = paymentFailedEmail();
            await sendEmail({ to: email, subject, html });
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
          await admin
            .from("subscriptions")
            .update({ status: "active" })
            .eq("stripe_customer_id", customerId)
            .eq("status", "past_due");
        }
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
