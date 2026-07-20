import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { trackEvent } from "@/lib/analytics";

/**
 * Toggle a "mark as done" item on a daily plan. Persists to plan_completions
 * (migration 004). RLS ensures a user can only touch their own rows.
 *
 * MW-S01: when the toggle comes from the Now view, the server confirms the
 * completion as a value event (now_action_done) only after the row is saved —
 * clients cannot claim this event directly.
 */
const CompleteInput = z.object({
  plan_id: z.string().uuid(),
  item_key: z.string().min(1).max(80),
  done: z.boolean(),
  source: z.enum(["now", "plan"]).optional(),
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
  const { plan_id, item_key, done, source } = parsed.data;

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
    const { data: planRow } = await supabase
      .from("daily_plans")
      .select("plan_mode")
      .eq("id", plan_id)
      .eq("user_id", user.id)
      .maybeSingle();
    const mode = planRow?.plan_mode;
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
