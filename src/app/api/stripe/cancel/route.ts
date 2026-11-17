import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";
import { trackEvent } from "@/lib/analytics";
import { deliverEmail } from "@/lib/email/deliver";
import { canceledEmail } from "@/lib/email/templates";

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
  // Audit B8: read as a three-way result. A DB outage returns `error` with
  // `data: null`; ignoring it told a paying user they had "no_subscription" on
  // the one path where failing to cancel matters most. Only a verified read may
  // conclude that — anything else is a retryable 503 with no Stripe call, the
  // same contract as the portal route. `error` is a sentence because the
  // billing UI prints it verbatim.
  const { data: sub, error: subReadErr } = await admin
    .from("subscriptions")
    .select("stripe_subscription_id, status, current_period_end, trial_end")
    .eq("user_id", user.id)
    .maybeSingle();

  if (subReadErr) {
    console.error("[stripe] cancel_subscription_read_failed", {
      event: "cancel_subscription_read_failed",
      user_id: user.id,
    });
    return NextResponse.json(
      {
        error:
          "We couldn't reach your billing details just now, so nothing was changed. Please try again in a moment.",
        code: "billing_unavailable",
        retryable: true,
      },
      { status: 503 }
    );
  }

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
    // If this mirror write fails the change still happened at Stripe, so the
    // request succeeds; the webhook re-syncs the row. Logged so a stale billing
    // page can be traced instead of guessed at.
    const { error: mirrorErr } = await admin
      .from("subscriptions")
      .update({ cancel_at_period_end: updated.cancel_at_period_end ?? false })
      .eq("user_id", user.id);
    if (mirrorErr) {
      console.error("[stripe] cancel_local_mirror_write_failed", {
        event: "cancel_local_mirror_write_failed",
        user_id: user.id,
      });
    }

    if (cancelAtPeriodEnd) {
      // Cancellation confirmation with the exact access-end date (Prompt 19).
      // Idempotent per subscription+period via the delivery ledger event key.
      const untilIso =
        sub.status === "trialing" ? sub.trial_end : sub.current_period_end;
      if (user.email) {
        const { subject, html } = canceledEmail(
          untilIso
            ? {
                date: new Date(untilIso).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                }),
              }
            : {}
        );
        await deliverEmail({
          eventKey: `canceled:${sub.stripe_subscription_id}:${untilIso ?? "period"}`,
          userId: user.id,
          template: "canceled",
          to: user.email,
          subject,
          html,
        });
      }
      trackEvent("cancellation_requested", {
        userId: user.id,
        properties: {
          surface: "billing",
          churn_type: "voluntary",
          ...(parsed.data.reason ? { cancel_reason: parsed.data.reason } : {}),
        },
      });
    } else {
      // MW-S09: reactivation is a server-confirmed billing action.
      trackEvent("reactivation_started", {
        userId: user.id,
        properties: { surface: "billing" },
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
