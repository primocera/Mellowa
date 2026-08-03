import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";
import { serverEnv } from "@/lib/env";
import { entitlementFor } from "@/lib/stripe/plans";
import { currencyFromRequest } from "@/lib/stripe/currency";
import { resolvePrice } from "@/lib/stripe/price-resolver";
import { classifyBillingRead } from "@/lib/stripe/billing-state";
import {
  chargeDateFor,
  resolveTrialConfig,
} from "@/lib/stripe/trial-experiment";

const CheckoutInput = z.object({
  interval: z.enum(["monthly", "yearly"]),
});

/**
 * MW-04: fail-closed response when we cannot verify billing state before a
 * Stripe mutation. Stable machine `code`, `retryable`, and safe user copy — no
 * raw Supabase/Stripe message ever reaches the client.
 */
function billingUnavailable(code: string) {
  return NextResponse.json(
    {
      error: code,
      code,
      retryable: true,
      message:
        "We couldn't confirm your billing status right now. Please try again in a moment.",
    },
    { status: 503 }
  );
}

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

  // Existing subscription row (holds the Stripe customer id + trial history).
  // A FAILED read must never be treated as "no subscription" — that would offer
  // an existing payer a second trial. Classify the read explicitly and fail
  // closed on `unavailable`, before any Stripe mutation.
  const { data: sub, error: subErr } = await admin
    .from("subscriptions")
    .select(
      "stripe_customer_id, status, trial_used_at, trial_variant, trial_days"
    )
    .eq("user_id", user.id)
    .maybeSingle();
  const billing = classifyBillingRead(sub, subErr);
  if (billing.state === "unavailable") {
    console.error("[stripe] billing read unavailable at checkout", {
      code: subErr?.code ?? "read_failed",
    });
    return billingUnavailable("billing_unavailable");
  }
  // null for verified_none (a genuine new customer), the row otherwise.
  const row = billing.row;

  // Canonical entitlement matrix decides whether a new checkout is allowed
  // (blocks trialing/active/incomplete/past_due/unpaid; allows none/canceled).
  if (!entitlementFor(row?.status ?? "none").checkout) {
    return NextResponse.json({ error: "already_subscribed" }, { status: 400 });
  }

  // Reuse the same Stripe customer across the account's lifetime.
  let customerId = row?.stripe_customer_id ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
    // Verify the link persisted BEFORE opening checkout. If the upsert fails the
    // Stripe customer exists but is unlinked; proceeding risks a second,
    // orphaned customer on the next attempt. Fail closed and emit a PII-safe
    // reconciliation signal (ids only — no email/journal/tokens).
    const { error: linkErr } = await admin.from("subscriptions").upsert(
      { user_id: user.id, stripe_customer_id: customerId, status: "incomplete" },
      { onConflict: "user_id" }
    );
    if (linkErr) {
      console.error("[stripe] billing_customer_link_failed", {
        event: "billing_customer_link_failed",
        user_id: user.id,
        stripe_customer_id: customerId,
        code: linkErr.code ?? "upsert_failed",
      });
      return billingUnavailable("customer_link_failed");
    }
  }

  const planName = parsed.data.interval === "monthly" ? "pro_monthly" : "pro_yearly";
  // USD-first, EUR for EU/EEA buyers (gated by EUR_PRICING_ENABLED). The
  // resolver returns the currency actually charged, with a USD fallback when a
  // EUR price is not configured for this interval — so a missing EUR price can
  // never break checkout.
  const requestedCurrency = currencyFromRequest(request);
  const { priceId: price, currency: chargedCurrency } = resolvePrice(
    parsed.data.interval,
    requestedCurrency
  );

  // One trial per person, ever. A user who has already consumed a trial
  // (canceled, past_due, deleted checkout, interval switch) starts paid.
  // Verified above: `row` reflects a real read, never a swallowed failure.
  const trialEligible = !row?.trial_used_at;

  // MW-V10-02: the trial length is decided here, on the server. A previously
  // pinned assignment always wins, so a user who has already been shown a
  // charge date keeps it even if the flag or rollout percentage changed.
  const trialConfig = resolveTrialConfig({ userId: user.id, pinned: row });

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
      // not be reproducible from stored state. Fail closed, before any Stripe
      // mutation, with the same machine code shape as other unavailable states.
      console.error("[stripe] could not pin trial variant", {
        code: pinError?.code ?? "no_row_matched",
      });
      return billingUnavailable("trial_pin_failed");
    }
  }

  try {
    const session = await stripe.checkout.sessions.create(
      {
        customer: customerId,
        mode: "subscription",
        // Same price id for every buyer; `currency` selects the matching
        // currency_option (USD default, EUR for EU/EEA). Stripe charges the
        // amount attached for that currency on this price.
        currency: chargedCurrency,
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
        /*
         * Idempotent per user + interval + trial-eligibility + trial length +
         * **price**, so a double click or retried request cannot create two
         * subscriptions, and a re-pinned length can never be silently served
         * from a cached session created for a different number of days.
         *
         * The price is in the key because leaving it out broke checkout
         * outright. Stripe caches an idempotency key for 24 hours and rejects
         * reuse with different parameters:
         *
         *   StripeIdempotencyError: Keys for idempotent requests can only be
         *   used with the same parameters they were first used with.
         *
         * So when the live prices were corrected from USD to EUR, every user
         * who had attempted checkout in the previous 24 hours got a 502 on
         * every retry — the key was identical, the price was not. It would have
         * healed itself a day later, which is the worst kind of failure: it
         * looks like an outage, resists every retry, and then vanishes before
         * anyone can debug it.
         *
         * Including the price means a price change immediately mints a new key,
         * and the double-click protection this exists for is unaffected: two
         * clicks a second apart still send identical parameters.
         */
        idempotencyKey: `checkout_${user.id}_${parsed.data.interval}_${
          trialEligible ? `trial${trialConfig.days}` : "paid"
        }_${price}_${chargedCurrency}`,
      }
    );

    // Everything the confirmation card discloses comes from this response —
    // the client never derives a trial length or charge date of its own.
    return NextResponse.json({
      url: session.url,
      trial: trialEligible,
      trialDays: trialEligible ? trialConfig.days : 0,
      currency: chargedCurrency,
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
