import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Ops/beta stats (Prompts 19 + 20). Read-only daily numbers for go/no-go
 * decisions — no dashboards, no alert emails. Gated by ADMIN_STATS_SECRET:
 *   curl -H "Authorization: Bearer $ADMIN_STATS_SECRET" /api/admin/stats
 * Returns aggregate counts only — no user content.
 */
export async function GET(request: Request) {
  const secret = process.env.ADMIN_STATS_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "not_configured" }, { status: 404 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const since = dayStart.toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const count = async (
    table: string,
    build?: (q: ReturnType<typeof admin.from> extends infer _ ? any : never) => any
  ) => {
    let q = admin.from(table).select("id", { count: "exact", head: true });
    if (build) q = build(q);
    const { count: c } = await q;
    return c ?? 0;
  };

  const [
    newProfilesToday,
    plansToday,
    plansWeek,
    safetyEventsWeek,
    failedStripeEvents,
    activeSubs,
  ] = await Promise.all([
    count("profiles", (q) => q.gte("created_at", since)),
    count("daily_plans", (q) => q.gte("created_at", since)),
    count("daily_plans", (q) => q.gte("created_at", weekAgo)),
    count("safety_events", (q) => q.gte("created_at", weekAgo)),
    count("stripe_events", (q) => q.eq("status", "failed")),
    count("subscriptions", (q) => q.in("status", ["trialing", "active"])),
  ]);

  const { data: costRows } = await admin
    .from("ai_usage_events")
    .select("estimated_cost_usd")
    .gte("created_at", since);
  const aiCostToday = (costRows ?? []).reduce(
    (sum, r) => sum + Number(r.estimated_cost_usd ?? 0),
    0
  );

  const { data: eventRows } = await admin
    .from("app_events")
    .select("event")
    .gte("created_at", weekAgo);
  const events7d: Record<string, number> = {};
  for (const r of eventRows ?? []) {
    events7d[r.event] = (events7d[r.event] ?? 0) + 1;
  }

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    today: {
      new_profiles: newProfilesToday,
      plans_generated: plansToday,
      ai_cost_usd: Number(aiCostToday.toFixed(4)),
    },
    week: {
      plans_generated: plansWeek,
      safety_events: safetyEventsWeek,
      events: events7d,
    },
    billing: {
      active_or_trialing: activeSubs,
      failed_stripe_events: failedStripeEvents,
    },
  });
}
