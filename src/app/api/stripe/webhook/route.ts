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
 * Stripe webhook — keeps the subscriptions table in sync.
 *
 * Local testing:
 *   stripe listen --forward-to localhost:3000/api/stripe/webhook
 *   (copy the printed whsec_... into STRIPE_WEBHOOK_SECRET in .env.local)
 *   stripe trigger checkout.session.completed
 */
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
      console.error("[stripe] cannot map subscription to a user", {
        subscription: subscription.id,
      });
      return;
    }

    const item = subscription.items.data[0];
    const periodEnd = item?.current_period_end;
    const priceId = item?.price.id;
    const planName =
      priceId === serverEnv.stripePriceProYearly ? "pro_yearly" : "pro_monthly";

    const toIso = (unix: number | null | undefined) =>
      unix ? new Date(unix * 1000).toISOString() : null;

    await admin.from("subscriptions").upsert(
      {
        user_id: targetUserId,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscription.id,
        plan_name: planName,
        status: subscription.status,
        current_period_end: toIso(periodEnd),
        trial_start: toIso(subscription.trial_start),
        trial_end: toIso(subscription.trial_end),
        cancel_at_period_end: subscription.cancel_at_period_end ?? false,
      },
      { onConflict: "user_id" }
    );
  }

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
      // Trial → active transition: subscription just converted to paid.
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
      // A recovered payment flips a past_due sub back to active. The
      // authoritative status still comes from subscription.updated, but this
      // reacts faster for the billing UI.
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

  return NextResponse.json({ received: true });
}
