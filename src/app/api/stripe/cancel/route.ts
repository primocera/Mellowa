import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";
import { trackEvent } from "@/lib/analytics";

const Input = z.object({
  action: z.enum(["cancel", "reactivate"]),
  // Optional and skippable by design — cancellation is never gated on a
  // survey (Prompt 18). Closed enum, no free text.
  reason: z
    .enum(["too_expensive", "not_using", "missing_features", "taking_a_break", "other"])
    .optional(),
});

/**
 * Cancel at period end / reactivate the caller's own subscription (Prompt 15).
 * Subscription id is resolved server-side from the user's row — ownership is
 * guaranteed, client ids are never trusted. Access continues until period end
 * on cancel; reactivate simply clears the flag before the period ends.
 */
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
  const parsed = Input.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: sub } = await admin
    .from("subscriptions")
    .select("stripe_subscription_id, status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!sub?.stripe_subscription_id) {
    return NextResponse.json({ error: "no_subscription" }, { status: 400 });
  }

  const cancelAtPeriodEnd = parsed.data.action === "cancel";

  try {
    const updated = await getStripe().subscriptions.update(
      sub.stripe_subscription_id,
      { cancel_at_period_end: cancelAtPeriodEnd }
    );

    // Reflect immediately so the billing page is correct without waiting for
    // the webhook (which remains the authoritative sync).
    await admin
      .from("subscriptions")
      .update({ cancel_at_period_end: updated.cancel_at_period_end ?? false })
      .eq("user_id", user.id);

    if (cancelAtPeriodEnd) {
      trackEvent("cancellation_requested", {
        userId: user.id,
        properties: {
          surface: "billing",
          churn_type: "voluntary",
          ...(parsed.data.reason ? { cancel_reason: parsed.data.reason } : {}),
        },
      });
    }

    return NextResponse.json({
      ok: true,
      cancel_at_period_end: updated.cancel_at_period_end ?? false,
    });
  } catch (err) {
    console.error("[stripe] cancel/reactivate failed", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Couldn't update your subscription. Please try again." },
      { status: 502 }
    );
  }
}
