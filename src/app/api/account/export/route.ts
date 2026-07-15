import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Every table that holds this user's personal data, keyed by their user column.
// stripe_events is global infrastructure (no user data) and is intentionally
// excluded.
const USER_TABLES: { table: string; column: string }[] = [
  { table: "wellbeing_profiles", column: "user_id" },
  { table: "daily_checkins", column: "user_id" },
  { table: "daily_plans", column: "user_id" },
  { table: "generated_meal_cards", column: "user_id" },
  { table: "habits", column: "user_id" },
  { table: "habit_logs", column: "user_id" },
  { table: "journal_entries", column: "user_id" },
  { table: "meal_ideas", column: "user_id" },
  { table: "plan_completions", column: "user_id" },
  { table: "shopping_lists", column: "user_id" },
  { table: "weekly_plans", column: "user_id" },
  { table: "safety_events", column: "user_id" },
  { table: "ai_usage_events", column: "user_id" },
  { table: "subscriptions", column: "user_id" },
];

/**
 * GDPR-style data export (Prompt 18). Returns everything Mellowa holds about
 * the caller as a single downloadable JSON file. Authenticated to the caller's
 * own account only; the admin client is used purely to read completely across
 * tables whose RLS may otherwise hide rows (e.g. safety_events), always scoped
 * strictly to this user's id.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const data: Record<string, unknown> = {
    export_generated_at: new Date().toISOString(),
    account: {
      id: user.id,
      email: user.email,
      created_at: user.created_at,
    },
  };

  const { data: profile } = await admin
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  data.profile = profile ?? null;

  for (const { table, column } of USER_TABLES) {
    const { data: rows, error } = await admin
      .from(table)
      .select("*")
      .eq(column, user.id);
    if (error) {
      console.error("[account/export] failed to read table", { table });
      return NextResponse.json(
        { error: "export_failed" },
        { status: 500 }
      );
    }
    data[table] = rows ?? [];
  }

  const filename = `mellowa-data-export-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
