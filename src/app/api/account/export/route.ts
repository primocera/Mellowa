import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

import { USER_DATA_REGISTRY } from "@/lib/privacy/registry";

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

  // Single authoritative registry (Prompt 4) — includes every user-owned
  // table (favourite_meals, plan_feedback, user-linked app_events, ...).
  // Paginated per table (Prompt 16): the export stays complete but every
  // query is bounded, so one huge table can't blow the statement timeout.
  const PAGE = 1000;
  for (const { table, column } of USER_DATA_REGISTRY) {
    const all: unknown[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data: rows, error } = await admin
        .from(table)
        .select("*")
        .eq(column, user.id)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) {
        console.error("[account/export] failed to read table", { table });
        return NextResponse.json({ error: "export_failed" }, { status: 500 });
      }
      all.push(...(rows ?? []));
      if (!rows || rows.length < PAGE) break;
    }
    data[table] = all;
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
