import { NextResponse } from "next/server";
import { z } from "zod";
import { startOfWeek, format, subDays } from "date-fns";
import { createClient } from "@/lib/supabase/server";
import {
  weeklyFacts,
  KEEP_OPTIONS,
  LIGHTER_OPTIONS,
  CONSTRAINT_OPTIONS,
  carryForwardEffects,
  type WeeklyReflectionSelections,
} from "@/lib/week/reflection";
import { trackEvent } from "@/lib/analytics";
import { isFlagEnabled } from "@/lib/flags";

/**
 * MW-S06: weekly reflection.
 *
 * GET returns deterministic factual summaries computed from the user's own
 * rows (never stored, never interpreted) plus any saved reflection for the
 * current week. POST saves the explicit bounded selections — the ONLY thing
 * that carries forward — after the client showed their exact effects.
 */

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
  const sinceIso = subDays(new Date(), 7).toISOString();

  const [plansRes, feedbackRes, favouritesRes, reflectionRes] = await Promise.all([
    supabase
      .from("daily_plans")
      .select("created_at, plan_mode")
      .eq("user_id", user.id)
      .gte("created_at", sinceIso),
    supabase
      .from("plan_feedback")
      .select("verdict, created_at")
      .eq("user_id", user.id)
      .gte("created_at", sinceIso),
    supabase
      .from("favourite_meals")
      .select("created_at")
      .eq("user_id", user.id)
      .gte("created_at", sinceIso),
    supabase
      .from("weekly_reflections")
      .select("keep, lighter, next_week_constraint")
      .eq("user_id", user.id)
      .eq("week_start", weekStart)
      .maybeSingle(),
  ]);

  const facts = weeklyFacts({
    plans: plansRes.data ?? [],
    feedback: feedbackRes.data ?? [],
    favourites: favouritesRes.data ?? [],
  });

  return NextResponse.json({
    week_start: weekStart,
    facts,
    reflection: reflectionRes.data ?? null,
  });
}

const Input = z.object({
  keep: z.array(z.enum(KEEP_OPTIONS)).max(4).default([]),
  lighter: z.enum(LIGHTER_OPTIONS).nullable().default(null),
  constraint: z.enum(CONSTRAINT_OPTIONS).nullable().default(null),
});

export async function POST(request: Request) {
  // MW-S10: experiment rollback switch — pausing never corrupts saved data.
  if (!isFlagEnabled("weekly_reflection")) {
    return NextResponse.json(
      {
        error: "feature_paused",
        user_message:
          "Weekly reflections are briefly paused — nothing you chose was lost. Please try again later.",
      },
      { status: 503 }
    );
  }
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
  const selections = parsed.data;
  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");

  const { error } = await supabase.from("weekly_reflections").upsert(
    {
      user_id: user.id,
      week_start: weekStart,
      keep: selections.keep.filter((k) => k !== "nothing"),
      lighter: selections.lighter,
      next_week_constraint: selections.constraint,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,week_start" }
  );
  if (error) {
    return NextResponse.json(
      {
        error: "Failed to save",
        user_message: "The reflection couldn't be saved just now — please try again.",
      },
      { status: 500 }
    );
  }

  trackEvent("weekly_reflection_completed", { userId: user.id });
  const effects = carryForwardEffects({
    keep: selections.keep.filter((k) => k !== "nothing"),
    lighter: selections.lighter === "nothing" ? null : selections.lighter,
    constraint:
      selections.constraint === "same_as_usual" ? null : selections.constraint,
  } as WeeklyReflectionSelections);
  if (effects.length > 0) {
    trackEvent("carry_forward_saved", { userId: user.id });
  }

  return NextResponse.json({ ok: true, effects });
}
