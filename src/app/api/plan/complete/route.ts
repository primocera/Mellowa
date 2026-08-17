import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { trackEvent } from "@/lib/analytics";
import { resolveCurrentDay } from "@/lib/dates/current-day";

/**
 * Toggle a "mark as done" item on a daily plan. Persists to plan_completions
 * (migration 004).
 *
 * MW-01 (v20): completions are cross-user–integrity critical. Before any
 * mutation the server proves the parent daily_plans row belongs to THIS user
 * and is the current-local-day canonical plan; the database enforces the same
 * parent-ownership invariant (migration 050) so a foreign UUID can neither be
 * written nor used to block the real owner through the global unique key.
 *   - missing / foreign plan  → generic 404 (never leaks existence);
 *   - superseded / past / future / cross-midnight plan → 409 stale_day;
 *   - timezone read unavailable → 503 (never a UTC-fallback mutation).
 *
 * MW-S01: when the toggle comes from the Now view, the server confirms the
 * completion as a value event (now_action_done) only after the row is durably
 * saved — clients cannot claim this event directly, and it is never emitted on
 * a 404 / 409 / 503 / DB failure.
 */
const CompleteInput = z.object({
  plan_id: z.string().uuid(),
  item_key: z.string().min(1).max(80),
  done: z.boolean(),
  source: z.enum(["now", "plan"]).optional(),
  // Optional bounded client date, used only as a fallback when the profile has
  // no valid stored timezone. Never trusted over server timezone truth.
  local_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

const PLAN_MODES = new Set(["minimum", "balanced", "reset", "custom"]);

/** Categorical item type from the stable completion key — never item text. */
function itemTypeForKey(
  key: string
): "meal" | "movement" | "calm_reset" | "habit" | "evening" | "focus" | null {
  if (key.startsWith("meal:")) return "meal";
  if (key === "movement") return "movement";
  if (key === "breathing" || key === "meditation" || key === "relaxation")
    return "calm_reset";
  if (key === "habit") return "habit";
  if (key === "evening") return "evening";
  if (key === "focus") return "focus";
  return null;
}

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

  const parsed = CompleteInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { plan_id, item_key, done, source, local_date } = parsed.data;

  // MW-01: resolve the user's current LOCAL day, failing closed on a read
  // outage. Never fall back to UTC and mutate the wrong day.
  const dayResolution = await resolveCurrentDay(supabase, user.id, {
    clientDate: local_date,
  });
  if (dayResolution.status === "unavailable") {
    return NextResponse.json(
      {
        error: "data_unavailable",
        user_message:
          "We couldn't reach your settings just now — nothing was changed. Please try again in a moment.",
      },
      { status: 503 }
    );
  }
  const today = dayResolution.day;

  // MW-01: prove parent-plan ownership BEFORE any completion mutation. A
  // missing or foreign plan returns a stable 404 without leaking existence; a
  // superseded / past / future plan (including a tab left open across local
  // midnight) returns 409 stale_day with refresh guidance.
  const { data: planRow, error: planLookupError } = await supabase
    .from("daily_plans")
    .select("id, plan_mode, plan_date, superseded_at")
    .eq("id", plan_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (planLookupError) {
    return NextResponse.json(
      {
        error: "data_unavailable",
        user_message:
          "We couldn't reach your plan just now — nothing was changed. Please try again in a moment.",
      },
      { status: 503 }
    );
  }
  if (!planRow) {
    // Missing or belongs to another user — never distinguish the two.
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (planRow.superseded_at !== null || planRow.plan_date !== today) {
    return NextResponse.json(
      {
        error: "stale_day",
        user_message:
          "This plan is no longer today's plan — refresh to pick up the current day.",
      },
      { status: 409 }
    );
  }

  if (done) {
    const { error } = await supabase.from("plan_completions").upsert(
      { user_id: user.id, daily_plan_id: plan_id, item_key },
      { onConflict: "daily_plan_id,item_key" }
    );
    if (error) {
      return NextResponse.json({ error: "Failed to save" }, { status: 500 });
    }
  } else {
    const { error } = await supabase
      .from("plan_completions")
      .delete()
      .eq("user_id", user.id)
      .eq("daily_plan_id", plan_id)
      .eq("item_key", item_key);
    if (error) {
      return NextResponse.json({ error: "Failed to save" }, { status: 500 });
    }
  }

  if (done && source === "now") {
    const item_type = itemTypeForKey(item_key);
    // Parent ownership + current day already proven above; reuse plan_mode from
    // the verified row rather than re-querying.
    const mode = planRow.plan_mode;
    trackEvent("now_action_done", {
      userId: user.id,
      properties: {
        ...(item_type ? { item_type } : {}),
        plan_mode: PLAN_MODES.has(mode ?? "")
          ? (mode as "minimum" | "balanced" | "reset" | "custom")
          : "unknown",
      },
    });
  }

  return NextResponse.json({ ok: true, item_key, done });
}
