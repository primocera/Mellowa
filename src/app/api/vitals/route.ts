import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DEVICE_CLASSES,
  VITAL_METRICS,
  VITAL_RATINGS,
  bucketValue,
  rateVital,
  sanitizeRoute,
  type VitalMetric,
} from "@/lib/perf/web-vitals";

/**
 * Real-user Web Vitals ingest (MW-V12-07).
 *
 * Anonymous by construction: this endpoint never reads the session, never
 * attributes to a user or an anon id, and stores only a metric, its rating, a
 * bucketed value, the app route, a coarse device class and the build id. The
 * rating is recomputed server-side from the value, so a client cannot forge a
 * flattering "good". Everything else is validated against a closed enum, so no
 * unbounded or sensitive string can be stored.
 */

const Input = z.object({
  metric: z.enum(VITAL_METRICS),
  value: z.number().finite().nonnegative().max(600_000),
  // Client-suggested rating is ignored — server recomputes. Accepted for shape
  // compatibility with the collector, then discarded.
  rating: z.enum(VITAL_RATINGS).optional(),
  route: z.string().max(200),
  deviceClass: z.enum(DEVICE_CLASSES),
  buildId: z
    .string()
    .regex(/^[a-z0-9._-]{1,40}$/i)
    .optional(),
});

export async function POST(request: Request) {
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

  const metric = parsed.data.metric as VitalMetric;
  const value = bucketValue(metric, parsed.data.value);
  // Server owns the rating and the route sanitisation — never the client.
  const rating = rateVital(metric, parsed.data.value);
  const route = sanitizeRoute(parsed.data.route);

  const admin = createAdminClient();
  const { error } = await admin.from("web_vitals").insert({
    metric,
    rating,
    value,
    route,
    device_class: parsed.data.deviceClass,
    build_id: parsed.data.buildId ?? "unknown",
  });
  if (error) {
    // Never fail a page over analytics; log a category, not a value.
    console.error("[vitals] insert failed", { message: error.message });
    return NextResponse.json({ ok: false }, { status: 200 });
  }
  return NextResponse.json({ ok: true });
}
