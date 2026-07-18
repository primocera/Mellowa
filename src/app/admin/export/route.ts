import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { buildMetricsReport, reportToCsv } from "@/lib/analytics/report";

/**
 * CSV export for the admin dashboard (Launch v6, Prompt 10). Cookie-based admin
 * authorization (same as the dashboard) — not the shared bearer secret, so a
 * browser download works only for a real admin user. 404 for everyone else.
 */
export async function GET(request: Request) {
  const adminId = await requireAdmin();
  if (!adminId) return new NextResponse("Not found", { status: 404 });

  const url = new URL(request.url);
  const windowDays = Math.min(Math.max(Number(url.searchParams.get("window") ?? 30), 1), 365);
  const release = url.searchParams.get("release");

  const report = await buildMetricsReport(windowDays, release);
  return new NextResponse(reportToCsv(report), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="mellowa-metrics-${windowDays}d.csv"`,
    },
  });
}
