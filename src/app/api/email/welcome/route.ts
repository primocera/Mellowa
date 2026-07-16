import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deliverEmail } from "@/lib/email/deliver";
import { welcomeEmail } from "@/lib/email/templates";

/**
 * Best-effort welcome email. Called by the signup form after a successful
 * sign-up. Auth is required so we only email the logged-in user's own address.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { subject, html } = welcomeEmail();
  const result = await deliverEmail({
    eventKey: `welcome:${user.id}`,
    userId: user.id,
    template: "welcome",
    to: user.email,
    subject,
    html,
  });
  return NextResponse.json({ ok: true, sent: result.sent, status: result.status });
}
