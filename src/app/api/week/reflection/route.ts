import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  weeklyFactsForWindow,
  KEEP_OPTIONS,
  LIGHTER_OPTIONS,
  CONSTRAINT_OPTIONS,
  carryForwardEffects,
  type WeeklyReflectionSelections,
} from "@/lib/week/reflection";
import { reflectionWindow } from "@/lib/weekly/window";
import { resolveTimeZoneState } from "@/lib/dates/current-day";
import { trackEvent } from "@/lib/analytics";
import { isFlagEnabled } from "@/lib/flags";

/**
 * MW-03: distinguish a genuinely missing/invalid timezone (documented UTC
 * fallback is safe) from a database read that FAILED (must fail closed). A
 * `null` return means the timezone read errored — the caller returns 503 and
 * never mutates or presents a week.
 */
async function resolveTimeZoneOrUnavailable(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<string | null> {
  const state = await resolveTimeZoneState(supabase, userId);
  if (state.status === "unavailable") return null;
  // resolved → the stored zone; missing/invalid → documented UTC fallback.
  return state.status === "resolved" ? state.timeZone : "UTC";
}

const DATA_UNAVAILABLE = {
  error: "data_unavailable",
  user_message:
    "We couldn't load your week just now — nothing you saved was lost. Please refresh in a moment.",
} as const;

/**
 * MW-S06 / MW-03: weekly reflection.
 *
 * A reflection is about the PREVIOUS completed Monday-Sunday week in the user's
 * stored IANA timezone — never a rolling seven days and never the server's
 * local week. The in-progress week is pending: it cannot be "closed out" early.
 *
 * GET returns deterministic factual summaries computed from the user's own rows
 * for the exact local boundaries of that completed week (never stored, never
 * interpreted), the source and target week, and any saved reflection. POST saves
 * the explicit bounded selections — the ONLY thing that carries forward — for the
 * completed source week, after the client showed their exact effects.
 */

/** YYYY-MM-DD, `n` days after `ymd` (UTC-midnight arithmetic). */
function addDaysYmd(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const tz = await resolveTimeZoneOrUnavailable(supabase, user.id);
  // MW-03: a failed timezone read is an outage, not a missing profile — fail
  // closed rather than silently computing the week in UTC.
  if (tz === null) {
    return NextResponse.json(DATA_UNAVAILABLE, { status: 503 });
  }
  const window = reflectionWindow(now, tz);
  if (!window) {
    return NextResponse.json({ error: "timezone_unresolved" }, { status: 500 });
  }
  const sourceWeekStart = window.reflectionWeekStart; // the completed week
  const targetWeekStart = window.currentWeekStart; // the week it will shape

  // UTC superset: fetch a couple of days of slack on each side of the completed
  // week so no local-boundary row is missed, then classify each row by its LOCAL
  // date inside weeklyFactsForWindow. This replaces created_at >= now-7d.
  const fromIso = `${addDaysYmd(sourceWeekStart, -2)}T00:00:00Z`;
  const toIso = `${addDaysYmd(sourceWeekStart, 9)}T00:00:00Z`;

  const [plansRes, feedbackRes, favouritesRes, reflectionRes] = await Promise.all([
    supabase
      .from("daily_plans")
      .select("created_at, plan_mode")
      .eq("user_id", user.id)
      .gte("created_at", fromIso)
      .lt("created_at", toIso),
    supabase
      .from("plan_feedback")
      .select("verdict, created_at")
      .eq("user_id", user.id)
      .gte("created_at", fromIso)
      .lt("created_at", toIso),
    supabase
      .from("favourite_meals")
      .select("created_at")
      .eq("user_id", user.id)
      .gte("created_at", fromIso)
      .lt("created_at", toIso),
    supabase
      .from("weekly_reflections")
      .select("keep, lighter, next_week_constraint")
      .eq("user_id", user.id)
      .eq("week_start", sourceWeekStart)
      .maybeSingle(),
  ]);

  // MW-03: if ANY required query failed, this is an outage — return 503 rather
  // than computing facts from partial arrays and presenting a real week as blank
  // (or a saved reflection as absent). An outage and a genuinely empty week are
  // observably different states.
  if (
    plansRes.error ||
    feedbackRes.error ||
    favouritesRes.error ||
    reflectionRes.error
  ) {
    return NextResponse.json(DATA_UNAVAILABLE, { status: 503 });
  }

  const facts = weeklyFactsForWindow(
    {
      plans: plansRes.data ?? [],
      feedback: feedbackRes.data ?? [],
      favourites: favouritesRes.data ?? [],
    },
    sourceWeekStart,
    tz
  );

  return NextResponse.json({
    // `week_start` is the completed SOURCE week the reflection is about.
    week_start: sourceWeekStart,
    week_end: addDaysYmd(sourceWeekStart, 6),
    target_week_start: targetWeekStart,
    // The in-progress week can never be closed out early; the UI shows a quiet
    // pending note for it rather than a "close out the week" action.
    current_week_start: targetWeekStart,
    state: reflectionRes.data ? "completed" : "available",
    facts,
    reflection: reflectionRes.data ?? null,
  });
}

const Input = z.object({
  keep: z.array(z.enum(KEEP_OPTIONS)).max(4).default([]),
  lighter: z.enum(LIGHTER_OPTIONS).nullable().default(null),
  constraint: z.enum(CONSTRAINT_OPTIONS).nullable().default(null),
  // Optional client-declared target. When present it MUST match the server's
  // current completed-week; a mismatch (stale page across a week boundary, or a
  // forged future/in-progress week) is refused rather than saved to the wrong week.
  week_start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
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

  // MW-03: the reflection is saved for the PREVIOUS completed week in the user's
  // timezone — the only week that can be closed out. The current in-progress
  // week is never a valid target.
  const now = new Date();
  const tz = await resolveTimeZoneOrUnavailable(supabase, user.id);
  // MW-03: fail closed on a timezone read outage — never save a reflection to a
  // UTC-fallback week.
  if (tz === null) {
    return NextResponse.json(DATA_UNAVAILABLE, { status: 503 });
  }
  const window = reflectionWindow(now, tz);
  if (!window) {
    return NextResponse.json({ error: "timezone_unresolved" }, { status: 500 });
  }
  const weekStart = window.reflectionWeekStart;

  if (selections.week_start && selections.week_start !== weekStart) {
    // The page was loaded before a local week boundary passed (or the target is
    // forged). Refuse rather than write the wrong week; the client should reload.
    return NextResponse.json(
      {
        error: "stale_week",
        current_week_start: weekStart,
        user_message:
          "The week moved on since this page loaded. Refresh to reflect on the week that just ended.",
      },
      { status: 409 }
    );
  }

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

  return NextResponse.json({
    ok: true,
    effects,
    week_start: weekStart,
    target_week_start: window.currentWeekStart,
  });
}
