import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";
import { serverEnv } from "@/lib/env";
import { verifyMellowaCustomerOwnership } from "@/lib/stripe/customer";

/**
 * MW-04/MW-95-01: fail-closed 503 when billing cannot be verified before a
 * Stripe read/mutation. Stable machine `code`, `retryable`, and safe copy — no
 * raw provider message, foreign-app detail or customer id ever reaches the user.
 */
function billingUnavailable(code: string, retryable = true) {
  return NextResponse.json(
    {
      error: code,
      code,
      retryable,
      message:
        "We couldn't confirm your billing status right now. Please try again in a moment.",
    },
    { status: 503 }
  );
}

/**
 * Creates an authenticated Stripe Billing Portal session (Prompt 15).
 * The customer id is always resolved server-side from the caller's own
 * subscriptions row — never accepted from the client.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const stripe = getStripe();
  const { data: sub } = await admin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!sub?.stripe_customer_id) {
    return NextResponse.json({ error: "no_customer" }, { status: 400 });
  }

  // MW-95-01: the stored customer id is not ownership proof on a shared Stripe
  // account. Prove ownership by exact metadata before opening a portal that
  // could otherwise let a user manage a foreign or wrong-user customer.
  const owned = await verifyMellowaCustomerOwnership(
    stripe,
    sub.stripe_customer_id,
    user.id
  );
  if (owned.kind !== "owned") {
    console.error("[stripe] portal_customer_ownership_failed", {
      event: "portal_customer_ownership_failed",
      user_id: user.id,
      result: owned.kind,
    });
    // Live mismatch or a row pointing at a gone customer both need
    // reconciliation (non-retryable); a transient read is retryable.
    return billingUnavailable(
      owned.kind === "unavailable"
        ? "billing_unavailable"
        : "customer_reconciliation_required",
      owned.kind === "unavailable"
    );
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: owned.customerId,
      return_url: `${serverEnv.appUrl}/billing`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[stripe] portal session failed", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Couldn't open billing management. Please try again." },
      { status: 502 }
    );
  }
}
