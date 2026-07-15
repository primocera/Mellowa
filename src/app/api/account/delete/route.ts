import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";

const Input = z.object({
  // Explicit typed confirmation so deletion can never happen by accident.
  confirm: z.literal("DELETE"),
});

/**
 * Permanent account + data deletion (Prompt 18).
 *
 * 1. Cancel any Stripe subscription immediately so the user is never billed
 *    again for a deleted account.
 * 2. Delete the auth user. All public tables FK to profiles(id) -> auth.users
 *    with ON DELETE CASCADE, so every row of the user's data is removed.
 *
 * The subscription id is resolved server-side; client ids are never trusted.
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
    return NextResponse.json(
      { error: "confirmation_required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // 1. Stop billing first — don't delete while a live subscription could charge.
  const { data: sub } = await admin
    .from("subscriptions")
    .select("stripe_subscription_id, status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (
    sub?.stripe_subscription_id &&
    sub.status &&
    !["canceled", "incomplete_expired"].includes(sub.status)
  ) {
    try {
      await getStripe().subscriptions.cancel(sub.stripe_subscription_id);
    } catch (err) {
      // Ignore "already canceled"; abort on anything else so we never orphan a
      // billable subscription behind a deleted account.
      const message = err instanceof Error ? err.message : "unknown";
      if (!/no such subscription|already canceled|resource_missing/i.test(message)) {
        console.error("[account/delete] stripe cancel failed", { message });
        return NextResponse.json(
          {
            error: "billing_cancel_failed",
            user_message:
              "We couldn't cancel your subscription automatically, so we stopped before deleting anything. Please try again or cancel in billing first.",
          },
          { status: 502 }
        );
      }
    }
  }

  // 2. Delete the auth user — cascades all personal data across every table.
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error("[account/delete] auth delete failed", {
      message: deleteError.message,
    });
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }

  // 3. Clear the caller's session so the browser is signed out.
  await supabase.auth.signOut();

  return NextResponse.json({ ok: true });
}
