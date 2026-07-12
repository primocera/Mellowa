import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";
import { serverEnv } from "@/lib/env";
import { ACTIVE_STATUSES, TRIAL_DAYS } from "@/lib/stripe/plans";

const CheckoutInput = z.object({
  interval: z.enum(["monthly", "yearly"]),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  // Existing subscription row (holds the Stripe customer id)
  const { data: sub } = await admin
    .from("subscriptions")
    .select("stripe_customer_id, status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (sub?.status && ACTIVE_STATUSES.includes(sub.status)) {
    return NextResponse.json({ error: "already_subscribed" }, { status: 400 });
  }

  // Reuse or create the Stripe customer (pattern ported from elevai)
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

  try {
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      success_url: `${serverEnv.appUrl}/billing?status=success`,
      cancel_url: `${serverEnv.appUrl}/pricing?status=cancelled`,
      metadata: { supabase_user_id: user.id, plan_name: planName },
      subscription_data: {
        trial_period_days: TRIAL_DAYS,
        metadata: { supabase_user_id: user.id, plan_name: planName },
      },
    });

    return NextResponse.json({ url: session.url });
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
