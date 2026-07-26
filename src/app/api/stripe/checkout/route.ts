import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";
import { serverEnv } from "@/lib/env";
import { entitlementFor } from "@/lib/stripe/plans";
import {
  chargeDateFor,
  resolveTrialConfig,
} from "@/lib/stripe/trial-experiment";

const CheckoutInput = z.object({
  interval: z.enum(["monthly", "yearly"]),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // A verified email is required before we take a payment method. Prevents
  // throwaway/unconfirmed accounts from cycling trials.
  if (!user.email_confirmed_at) {
    return NextResponse.json({ error: "email_unverified" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CheckoutInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const stripe = getStripe();
  const admin = createAdminClient();

  // Existing subscription row (holds the Stripe customer id + trial history)
  const { data: sub } = await admin
    .from("subscriptions")
    .select(
      "stripe_customer_id, status, trial_used_at, trial_variant, trial_days"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  // Canonical entitlement matrix decides whether a new checkout is allowed
  // (blocks trialing/active/incomplete/past_due/unpaid; allows none/canceled).
  if (!entitlementFor(sub?.status ?? "none").checkout) {
    return NextResponse.json({ error: "already_subscribed" }, { status: 400 });
  }

  // Reuse the same Stripe customer across the account's lifetime.
  let customerId = sub?.stripe_customer_id ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
    await admin.from("subscriptions").upsert(
      { user_id: user.id, stripe_customer_id: customerId, status: "incomplete" },
      { onConflict: "user_id" }
    );
  }

  const planName = parsed.data.interval === "monthly" ? "pro_monthly" : "pro_yearly";
  const price =
    parsed.data.interval === "monthly"
      ? serverEnv.stripePriceProMonthly
      : serverEnv.stripePriceProYearly;

  // One trial per person, ever. A user who has already consumed a trial
  // (canceled, past_due, deleted checkout, interval switch) starts paid.
  const trialEligible = !sub?.trial_used_at;

  // MW-V10-02: the trial length is decided here, on the server. A previously
  // pinned assignment always wins, so a user who has already been shown a
  // charge date keeps it even if the flag or rollout percentage changed.
  const trialConfig = resolveTrialConfig({ userId: user.id, pinned: sub });

  // Pin before creating the session, so the length Stripe is asked for and the
  // length the app discloses can never diverge — including on a retry after a
  // network failure, which re-reads this same pinned row.
  if (trialEligible && trialConfig.source !== "pinned") {
    const { data: pinned, error: pinError } = await admin
      .from("subscriptions")
      .update({
        trial_variant: trialConfig.variant,
        trial_days: trialConfig.days,
        trial_variant_assigned_at: new Date().toISOString(),
      })
      .eq("user_id", user.id)
      // Matching zero rows is not an error to Postgres, but it means the
      // assignment was not stored — treat it exactly like a failed write.
      .select("user_id");
    if (pinError || !pinned?.length) {
      // Never open checkout on an unpinned assignment: the disclosure would
      // not be reproducible from stored state.
      console.error("[stripe] could not pin trial variant", {
        message: pinError?.message ?? "no subscription row matched",
      });
      return NextResponse.json(
        { error: "We couldn't start checkout right now. Please try again." },
        { status: 502 }
      );
    }
  }

  try {
    const session = await stripe.checkout.sessions.create(
      {
        customer: customerId,
        mode: "subscription",
        line_items: [{ price, quantity: 1 }],
        success_url: `${serverEnv.appUrl}/billing?status=success`,
        cancel_url: `${serverEnv.appUrl}/pricing?status=cancelled`,
        metadata: { supabase_user_id: user.id, plan_name: planName },
        subscription_data: {
          ...(trialEligible ? { trial_period_days: trialConfig.days } : {}),
          metadata: {
            supabase_user_id: user.id,
            plan_name: planName,
            // Allowlisted variant code only — the webhook re-validates it
            // against the same allowlist before storing anything.
            ...(trialEligible ? { trial_variant: trialConfig.variant } : {}),
          },
        },
      },
      {
        // Idempotent per user + interval + trial-eligibility + trial length, so
        // a double click or retried request cannot create two subscriptions,
        // and a re-pinned length can never be silently served from a cached
        // session created for a different number of days.
        idempotencyKey: `checkout_${user.id}_${parsed.data.interval}_${
          trialEligible ? `trial${trialConfig.days}` : "paid"
        }`,
      }
    );

    // Everything the confirmation card discloses comes from this response —
    // the client never derives a trial length or charge date of its own.
    return NextResponse.json({
      url: session.url,
      trial: trialEligible,
      trialDays: trialEligible ? trialConfig.days : 0,
      chargeDate: trialEligible
        ? chargeDateFor(trialConfig.days)
        : chargeDateFor(0),
    });
  } catch (err) {
    console.error("[stripe] checkout session failed", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "We couldn't start checkout right now. Please try again." },
      { status: 502 }
    );
  }
}
