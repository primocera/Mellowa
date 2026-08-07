import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { trackEvent } from "@/lib/analytics";

/**
 * MW-95-03: server-authoritative activation milestone.
 *
 * `onboarding_completed` used to be a client claim (`trackClient(...)` in the
 * wizard), so a browser could assert activation without any durable write. It is
 * now emitted here, and ONLY after the server itself confirms the caller's
 * wellbeing_profiles baseline row exists. The client event endpoint rejects the
 * event (it is server-authoritative), so the browser can no longer spoof it.
 *
 * Idempotent: a retried request (double submit, refresh, flaky network) never
 * writes a second milestone — the emit is skipped when one already exists for
 * this user. Carries no field values, only `surface`.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  // The durable-success gate: no milestone without a persisted baseline. This is
  // what makes the event trustworthy — the server, not the browser, confirms the
  // planning baseline actually landed.
  const { data: profile, error: profileErr } = await admin
    .from("wellbeing_profiles")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileErr) {
    // Fail closed: an unverifiable read must never be reported as completion.
    return NextResponse.json({ error: "profile_unverified" }, { status: 503 });
  }
  if (!profile) {
    return NextResponse.json({ error: "profile_not_saved" }, { status: 409 });
  }

  // Idempotent emit: skip if this user already has the milestone.
  const { data: existing, error: existingErr } = await admin
    .from("app_events")
    .select("id")
    .eq("user_id", user.id)
    .eq("event", "onboarding_completed")
    .limit(1)
    .maybeSingle();
  if (existingErr) {
    return NextResponse.json({ error: "event_read_failed" }, { status: 503 });
  }
  if (!existing) {
    trackEvent("onboarding_completed", {
      userId: user.id,
      properties: { surface: "onboarding" },
    });
  }

  return NextResponse.json({ ok: true, alreadyRecorded: Boolean(existing) });
}
