import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  deriveLearned,
  isVerdict,
  type FeedbackRow,
  type SignalSuppression,
} from "@/lib/feedback/learned";
import {
  reflectionSelectionsFromRow,
  isReflectionFresh,
  carryForwardEffects,
} from "@/lib/week/reflection";
import { trackEvent } from "@/lib/analytics";

const Input = z.object({
  plan_id: z.string().uuid(),
  item_key: z.string().min(1).max(60), // "plan", "meal:breakfast", "movement", ...
  verdict: z.enum([
    "helpful",
    "not_for_me",
    "too_much",
    "too_little_time",
    "didnt_fit_food",
  ]),
  note: z.string().max(300).optional().default(""),
});

/**
 * Plan feedback (Prompt 10): one gentle verdict per plan item. Upsert so the
 * user can change their mind. Recent verdicts are fed into future generations
 * as preference hints — learning, never judgment.
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
  const { plan_id, item_key, verdict, note } = parsed.data;

  // RLS also protects this; the explicit check gives a clean 404.
  const { data: plan } = await supabase
    .from("daily_plans")
    .select("id")
    .eq("id", plan_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  const { error } = await supabase.from("plan_feedback").upsert(
    {
      user_id: user.id,
      daily_plan_id: plan_id,
      item_key,
      verdict,
      note: note || null,
    },
    { onConflict: "daily_plan_id,item_key" }
  );
  if (error) {
    return NextResponse.json({ error: "Failed to save feedback" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/** Read the user's suppression boundaries (MW-S03). */
async function readSuppressions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<SignalSuppression[]> {
  const { data } = await supabase
    .from("learned_signal_suppressions")
    .select("signal, suppressed_at")
    .eq("user_id", userId);
  return (data ?? []) as SignalSuppression[];
}

/**
 * The transparent "Mellowa learned" list (Prompt 14, MW-S03): what recent
 * feedback has taught the app, derived from canonical signals only — never
 * notes — with each signal's concrete effect on future plans, honouring
 * suppression boundaries.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [{ data }, suppressions, { data: reflection }] = await Promise.all([
    supabase
      .from("plan_feedback")
      .select("item_key, verdict, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(60),
    readSuppressions(supabase, user.id),
    supabase
      .from("weekly_reflections")
      .select("keep, lighter, next_week_constraint, created_at")
      .eq("user_id", user.id)
      .order("week_start", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const learned = deriveLearned((data ?? []) as FeedbackRow[], suppressions).map(
    ({ signal, label, hint }) => ({ signal, label, effect: hint })
  );

  // MW-V9-05: the same carry-forward view the weekly prompt builder uses, so
  // the center shows exactly what a future weekly plan would apply. Stale
  // reflections (>14 days) no longer carry forward and are shown as inactive.
  const carryForward =
    reflection && isReflectionFresh(reflection.created_at)
      ? carryForwardEffects(reflectionSelectionsFromRow(reflection))
      : [];

  return NextResponse.json({ learned, carryForward });
}

/**
 * MW-S03: remove or restore a learned signal, or undo one feedback tap.
 *
 * - ?signal=X          → suppress the signal from now on. The user's feedback
 *                        history is KEPT; the signal only comes back once the
 *                        threshold is met from feedback given after removal.
 * - ?signal=X&restore=1 → undo the removal (deletes the suppression row).
 * - ?plan_id=…&item_key=… → delete that single feedback row (undo a tap).
 */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const planId = url.searchParams.get("plan_id");
  const itemKey = url.searchParams.get("item_key");
  if (planId && itemKey) {
    const idCheck = z.string().uuid().safeParse(planId);
    if (!idCheck.success || itemKey.length > 60) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    const { error } = await supabase
      .from("plan_feedback")
      .delete()
      .eq("user_id", user.id)
      .eq("daily_plan_id", planId)
      .eq("item_key", itemKey);
    if (error) {
      return NextResponse.json({ error: "Failed to remove" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, undone: true });
  }

  // MW-V9-05: "Reset learned preferences" — suppress every currently-active
  // learned signal at once. Same boundary mechanism as a single removal: it
  // only sets suppression rows, so feedback history and stable settings are
  // untouched. Undo restores exactly the set this reset suppressed (the client
  // calls per-signal restore for each returned signal).
  if (url.searchParams.get("reset") === "learned") {
    const [{ data: fb }, suppressions] = await Promise.all([
      supabase
        .from("plan_feedback")
        .select("item_key, verdict, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(60),
      readSuppressions(supabase, user.id),
    ]);
    const active = deriveLearned((fb ?? []) as FeedbackRow[], suppressions).map(
      (l) => l.signal as string
    );
    if (active.length === 0) {
      return NextResponse.json({ ok: true, reset: [] });
    }
    const now = new Date().toISOString();
    const { error } = await supabase.from("learned_signal_suppressions").upsert(
      active.map((signal) => ({ user_id: user.id, signal, suppressed_at: now })),
      { onConflict: "user_id,signal" }
    );
    if (error) {
      return NextResponse.json({ error: "Failed to reset" }, { status: 500 });
    }
    for (const signal of active) {
      trackEvent("learned_signal_removed", { userId: user.id, properties: { signal } });
    }
    return NextResponse.json({ ok: true, reset: active });
  }

  const signal = url.searchParams.get("signal") ?? "";
  if (!isVerdict(signal) || signal === "helpful") {
    return NextResponse.json({ error: "Invalid signal" }, { status: 400 });
  }

  if (url.searchParams.get("restore")) {
    const { error } = await supabase
      .from("learned_signal_suppressions")
      .delete()
      .eq("user_id", user.id)
      .eq("signal", signal);
    if (error) {
      return NextResponse.json({ error: "Failed to restore" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, restored: true });
  }

  const { error } = await supabase.from("learned_signal_suppressions").upsert(
    { user_id: user.id, signal, suppressed_at: new Date().toISOString() },
    { onConflict: "user_id,signal" }
  );
  if (error) {
    return NextResponse.json({ error: "Failed to remove" }, { status: 500 });
  }
  trackEvent("learned_signal_removed", {
    userId: user.id,
    properties: { signal },
  });
  return NextResponse.json({ ok: true });
}
