import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { trackEvent } from "@/lib/analytics";

/**
 * MW-95-03 / MW-V17-06: server-authoritative, exactly-once activation milestone.
 *
 * Completion is recorded here — never claimed by the browser (the client event
 * endpoint rejects `onboarding_completed`) — and ONLY after the server confirms
 * the caller's durable wellbeing_profiles baseline exists.
 *
 * Exactly-once is enforced at the DATABASE, not by a read-then-write race: the
 * authoritative fact is a row in `onboarding_completions`, whose primary key
 * allows at most one per user (migration 043). The insert is AWAITED — a unique
 * violation (23505) means it was already completed (idempotent success), and any
 * other write failure returns a typed retryable state rather than reporting
 * success over an unknown write. The `onboarding_completed` analytics event is
 * emitted only on the FIRST successful completion, so it too lands once.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  // The durable-success gate: no milestone without a persisted baseline. The
  // server, not the browser, confirms the planning baseline actually landed.
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

  // Exactly-once completion. The onboarding_completions primary key guarantees at
  // most one row per user, so two concurrent/retried completes converge on one.
  const { error: completeErr } = await admin
    .from("onboarding_completions")
    .insert({ user_id: user.id });

  if (completeErr) {
    // 23505 = unique_violation: already completed — idempotent success.
    if (completeErr.code === "23505") {
      return NextResponse.json({ ok: true, alreadyRecorded: true });
    }
    // Any other write failure is unknown state; do NOT claim completion. The
    // profile is already durable, so a retry re-runs this insert and the primary
    // key guarantees it lands exactly once.
    return NextResponse.json({ error: "completion_write_failed", retryable: true }, { status: 503 });
  }

  // First completion only: emit the analytics milestone (a reflection of the
  // authoritative completion row, so it too is recorded once per user).
  trackEvent("onboarding_completed", { userId: user.id, properties: { surface: "onboarding" } });

  return NextResponse.json({ ok: true, alreadyRecorded: false });
}
