import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const Input = z.object({
  plan_id: z.string().uuid(),
  item_key: z.string().min(1).max(60), // "plan", "meal:breakfast", "movement", ...
  verdict: z.enum(["helpful", "not_for_me"]),
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
