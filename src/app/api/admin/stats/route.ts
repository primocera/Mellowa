import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { requireBearerSecret } from "@/lib/cron-auth";

/**
 * Ops/beta stats (Prompts 19 + 20). Read-only daily numbers for go/no-go
 * decisions — no dashboards, no alert emails. Gated by ADMIN_STATS_SECRET:
 *   curl -H "Authorization: Bearer $ADMIN_STATS_SECRET" /api/admin/stats
 * Returns aggregate counts only — no user content.
 */
export async function GET(request: Request) {
  const denied = requireBearerSecret(request, serverEnv.adminStatsSecret);
  if (denied) return denied;

  const admin = createAdminClient();
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const since = dayStart.toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Minimal structural type for the filter chain — the Supabase builder
  // generics are too deep to name directly here.
  interface CountQuery {
    gte(column: string, value: string): CountQuery;
    eq(column: string, value: string): CountQuery;
    in(column: string, values: string[]): CountQuery;
    then<T>(onfulfilled: (value: { count: number | null }) => T): Promise<T>;
  }
  const count = async (
    table: string,
    build?: (q: CountQuery) => CountQuery
  ) => {
    let q = admin
      .from(table)
      .select("id", { count: "exact", head: true }) as unknown as CountQuery;
    if (build) q = build(q);
    const { count: c } = await q.then((r) => r);
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
