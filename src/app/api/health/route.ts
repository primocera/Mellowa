import { NextResponse } from "next/server";
import { releaseVersion } from "@/lib/health";

/**
 * Shallow liveness check (v6 Prompt 5). Public, no dependencies, no details:
 * proves the deployment serves requests. Point a free uptime monitor here.
 */
export async function GET() {
  return NextResponse.json({ ok: true, version: releaseVersion() });
}
