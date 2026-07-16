import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { deriveLearned, isVerdict, type FeedbackRow } from "@/lib/feedback/learned";

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

/**
 * The transparent "Mellowa learned" list (Prompt 14): what recent feedback has
 * taught the app, derived from canonical signals only — never notes.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabase
    .from("plan_feedback")
    .select("item_key, verdict")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(60);

  const learned = deriveLearned((data ?? []) as FeedbackRow[]).map(
    ({ signal, label }) => ({ signal, label })
  );
  return NextResponse.json({ learned });
}

/**
 * Forget a learned signal (Prompt 14): removes the feedback rows of that
 * verdict so the app stops acting on it. Users stay in control of what's kept.
 */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const signal = new URL(request.url).searchParams.get("signal") ?? "";
  if (!isVerdict(signal) || signal === "helpful") {
    return NextResponse.json({ error: "Invalid signal" }, { status: 400 });
  }

  const { error } = await supabase
    .from("plan_feedback")
    .delete()
    .eq("user_id", user.id)
    .eq("verdict", signal);
  if (error) {
    return NextResponse.json({ error: "Failed to remove" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
