import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";
import { verifyMellowaCustomerOwnership } from "@/lib/stripe/customer";
import { USER_DATA_REGISTRY } from "@/lib/privacy/registry";
import { trackEvent } from "@/lib/analytics";
import { deliverEmail } from "@/lib/email/deliver";
import { accountDeletedEmail } from "@/lib/email/templates";

const Input = z.object({
  // Explicit typed confirmation so deletion can never happen by accident.
  confirm: z.literal("DELETE"),
});

/**
 * Permanent account + data deletion (Prompt 18; hardened MW-V17-04).
 *
 * The order is the correctness property here. Confirmation email and the
 * `account_deleted` analytics event must be recorded ONLY after the auth
 * identity is actually deleted AND verified gone — otherwise a failed deletion
 * could send a false "your account is deleted" email and report a deletion that
 * never happened. And on a SHARED Stripe account, a subscription is cancelled
 * only after proving the customer behind it is Mellowa-owned, so a foreign or
 * wrong-user object is never mutated.
 *
 * Ordered, irreversible steps:
 *   1. authenticate + capture the email in process (never persisted)
 *   2. read billing state (fail closed on an unreadable read)
 *   3. verify Mellowa ownership, then cancel if a live subscription is ours
 *   4. delete the auth identity → cascades all personal data
 *   5. VERIFY the identity is gone
 *   6. explicit belt-and-braces data purge + session invalidation
 *   7. only now: queue the confirmation email (idempotent) and record the event
 *
 * Idempotency: deleting the identity invalidates the session, so a duplicate or
 * retried request fails auth at step 1 and cannot re-send the email or
 * re-record the event. The email uses a deterministic outbox key, so even a
 * retried delivery is de-duplicated.
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
    return NextResponse.json({ error: "confirmation_required" }, { status: 400 });
  }

  // Captured in process only, before the identity is deleted. Never persisted.
  const userId = user.id;
  const email = user.email ?? null;

  const admin = createAdminClient();

  // 1. Read billing state. A failed read must NOT fall through to deletion —
  //    we cannot prove there is no live subscription to cancel, so fail closed.
  const { data: sub, error: subReadErr } = await admin
    .from("subscriptions")
    .select("stripe_subscription_id, stripe_customer_id, status")
    .eq("user_id", userId)
    .maybeSingle();
  if (subReadErr) {
    console.error("[account/delete] subscription read failed");
    return NextResponse.json(
      {
        error: "billing_unavailable",
        retryable: true,
        user_message:
          "We couldn't confirm your billing status just now, so nothing was changed. Please try again in a moment.",
      },
      { status: 503 }
    );
  }

  // 2. Stop billing first — but only a subscription we can PROVE is ours, on a
  //    shared Stripe account. An active row without a verifiable Mellowa-owned
  //    customer is never cancelled.
  const isCancellable =
    sub?.stripe_subscription_id &&
    sub.status &&
    !["canceled", "incomplete_expired"].includes(sub.status);

  if (isCancellable) {
    if (!sub.stripe_customer_id) {
      // A live subscription with no stored customer cannot be ownership-checked;
      // fail closed rather than cancel a subscription we cannot attribute.
      console.error("[account/delete] cancellable subscription has no customer id");
      return NextResponse.json(
        {
          error: "billing_reconciliation_required",
          retryable: false,
          user_message:
            "We couldn't confirm your subscription, so we stopped before deleting anything. Please cancel in billing first or contact support.",
        },
        { status: 409 }
      );
    }
    const stripe = getStripe();
    const owned = await verifyMellowaCustomerOwnership(
      stripe,
      sub.stripe_customer_id,
      userId
    );
    if (owned.kind === "unavailable") {
      return NextResponse.json(
        {
          error: "billing_unavailable",
          retryable: true,
          user_message:
            "We couldn't confirm your billing status just now, so nothing was changed. Please try again in a moment.",
        },
        { status: 503 }
      );
    }
    if (owned.kind === "mismatch") {
      // Foreign app, wrong user, or an untagged legacy customer: never cancel it
      // and never delete over it — this needs reconciliation, not a silent pass.
      console.error("[account/delete] customer ownership not proven", {
        event: "delete_customer_ownership_failed",
      });
      return NextResponse.json(
        {
          error: "billing_reconciliation_required",
          retryable: false,
          user_message:
            "We couldn't confirm your subscription, so we stopped before deleting anything. Please cancel in billing first or contact support.",
        },
        { status: 409 }
      );
    }
    // owned → cancel; missing (customer gone/deleted) → nothing to cancel.
    if (owned.kind === "owned") {
      try {
        await stripe.subscriptions.cancel(sub.stripe_subscription_id);
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown";
        // Tolerate "already canceled"; abort on anything else so we never orphan
        // a billable subscription behind a deleted account.
        if (!/no such subscription|already canceled|resource_missing/i.test(message)) {
          console.error("[account/delete] stripe cancel failed");
          return NextResponse.json(
            {
              error: "billing_cancel_failed",
              retryable: true,
              user_message:
                "We couldn't cancel your subscription automatically, so we stopped before deleting anything. Please try again or cancel in billing first.",
            },
            { status: 502 }
          );
        }
      }
    }
  }

  // 3. Delete the auth user — cascades all personal data across every table.
  //    NOTHING user-facing (email, analytics) has happened yet.
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    console.error("[account/delete] auth delete failed");
    return NextResponse.json(
      { error: "delete_failed", retryable: true },
      { status: 500 }
    );
  }

  // 4. VERIFY the identity is actually gone. A successful delete response plus a
  //    not-found follow-up is the required proof before we claim success.
  const { data: check } = await admin.auth.admin.getUserById(userId);
  if (check?.user) {
    console.error("[account/delete] identity still present after delete");
    return NextResponse.json(
      { error: "delete_unverified", retryable: true },
      { status: 500 }
    );
  }

  // 5. Belt-and-braces: verify no user-linked rows remain (Prompt 4). Cascades
  //    should have removed everything; any remainder is deleted explicitly.
  const remaining: string[] = [];
  for (const { table, column, onDelete } of USER_DATA_REGISTRY) {
    if (onDelete === "anonymize") continue; // FK is ON DELETE SET NULL
    const { count } = await admin
      .from(table)
      .select(column, { count: "exact", head: true })
      .eq(column, userId);
    if ((count ?? 0) > 0) {
      remaining.push(table);
      await admin.from(table).delete().eq(column, userId);
    }
  }
  if (remaining.length > 0) {
    console.error("[account/delete] cascade left rows; deleted explicitly", {
      tables: remaining,
    });
  }

  // 6. Clear the caller's session so the browser is signed out.
  await supabase.auth.signOut();

  // 7. ONLY NOW, after verified deletion: send the confirmation and record the
  //    authoritative event. The email uses the captured address and a
  //    deterministic outbox key (idempotent). The event carries no user id — the
  //    identity is gone — only the surface category.
  if (email) {
    const { subject, html } = accountDeletedEmail();
    await deliverEmail({
      eventKey: `account_deleted:${userId}`,
      userId: null, // the ledger row must survive the cascade
      template: "account_deleted",
      to: email,
      subject,
      html,
    });
  }
  trackEvent("account_deleted", { userId: null, properties: { surface: "settings" } });

  return NextResponse.json({ ok: true });
}
