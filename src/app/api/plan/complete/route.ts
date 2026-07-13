import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Toggle a "mark as done" item on a daily plan. Persists to plan_completions
 * (migration 004). RLS ensures a user can only touch their own rows.
 */
const CompleteInput = z.object({
  plan_id: z.string().uuid(),
  item_key: z.string().min(1).max(80),
  done: z.boolean(),
});

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
  const { plan_id, item_key, done } = parsed.data;

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

  return NextResponse.json({ ok: true, item_key, done });
}
