import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { recordAdminAction } from "@/lib/admin/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { readExclusionRegistry } from "@/lib/analytics/facts";
import {
  SupportTicketInput,
  SupportBatchImport,
  ticketChronologyOk,
  type SupportTicketInputType,
} from "@/lib/support/taxonomy";
import { supportBurden, type SupportTicketRow } from "@/lib/support/metrics";
import { supportIngestionCoverage } from "@/lib/support/ingestion";

/**
 * MW-V18-08: privacy-safe support-burden ledger.
 *
 * POST — import/update ONE ticket (category/severity/timings only; the schema
 *        has no body/subject/email field, so content cannot enter). Admin-only,
 *        Zod-validated, idempotent by external_ref, audited, best-effort rate
 *        limited.
 * GET  — the aggregate burden report over mature cohorts, staff/test excluded.
 *
 * No message content is ever stored or returned — only counts and timings.
 */

// Best-effort per-actor limiter. In a single serverless instance this bounds an
// accidental import loop; it is a safeguard, not a security control (the real
// gate is requireAdmin).
const RATE_MAX = 120;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(actorId: string, now = Date.now()): boolean {
  const cur = hits.get(actorId);
  if (!cur || now > cur.resetAt) {
    hits.set(actorId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  cur.count += 1;
  return cur.count > RATE_MAX;
}

/** Map a validated ticket to its ledger row (metadata only — no content). */
function toRow(t: SupportTicketInputType): Record<string, unknown> {
  return {
    external_ref: t.external_ref ?? null,
    dedupe_key: t.dedupe_key,
    account_user_id: t.account_user_id ?? null,
    category: t.category,
    severity: t.severity,
    product_area: t.product_area ?? null,
    plan: t.plan,
    channel: t.channel ?? null,
    status: t.status,
    reopened_count: t.reopened_count,
    first_response_at: t.first_response_at ?? null,
    resolved_at: t.resolved_at ?? null,
    ...(t.created_at ? { created_at: t.created_at } : {}),
    updated_at: new Date().toISOString(),
  };
}

/**
 * MW-07: privacy-safe batch import. Each ticket is strict-validated (forbidden
 * keys like body/subject/email are rejected), chronology is checked, and rows
 * upsert idempotently by external_ref. A durable support_ingestion_runs row
 * records the source, counts and coverage window so verification is evidence,
 * not attestation. On any invalid row the whole batch is rejected (no partial,
 * ambiguous import).
 */
async function handleBatchImport(body: unknown, actorId: string) {
  const parsed = SupportBatchImport.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const batch = parsed.data;
  const badChrono = batch.tickets.filter((t) => !ticketChronologyOk(t));
  if (badChrono.length > 0) {
    return NextResponse.json(
      { error: "chronology_invalid", count: badChrono.length },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  let imported = 0;
  let updated = 0;
  for (const t of batch.tickets) {
    const row = toRow(t);
    // Idempotent by the UNIQUE external_ref when present (re-import = update);
    // otherwise insert (dedupe_key is deduped at the burden layer, and only
    // external_ref is a DB unique key — matching the single-import path).
    const q = t.external_ref
      ? admin.from("support_tickets").upsert(row, { onConflict: "external_ref" }).select("id")
      : admin.from("support_tickets").insert(row).select("id");
    const { error } = await q;
    if (error) {
      return NextResponse.json({ error: "write_failed", importedSoFar: imported }, { status: 503 });
    }
    if (t.external_ref) updated += 1;
    else imported += 1;
  }

  // Durable coverage evidence.
  const { error: runErr } = await admin.from("support_ingestion_runs").insert({
    source: batch.source,
    imported_count: imported,
    updated_count: updated,
    rejected_count: 0,
    coverage_start: batch.coverage_start ?? null,
    coverage_end: batch.coverage_end ?? null,
    actor_user_id: actorId,
  });
  if (runErr) {
    return NextResponse.json({ error: "coverage_write_failed" }, { status: 503 });
  }

  await recordAdminAction({
    actorUserId: actorId,
    action: "support_batch_import",
    targetUserId: null,
    reason: `support batch import: ${imported} new / ${updated} updated (${batch.source})`,
  });

  return NextResponse.json({ ok: true, imported, updated, source: batch.source });
}

export async function POST(request: Request) {
  const actorId = await requireAdmin();
  if (!actorId) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (rateLimited(actorId)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // MW-07: batch metadata import. A body carrying a `tickets` array is a batch;
  // it records a durable support_ingestion_runs row so `verified` derives from
  // real coverage, not an env flag alone.
  if (body && typeof body === "object" && Array.isArray((body as { tickets?: unknown }).tickets)) {
    return handleBatchImport(body, actorId);
  }

  const parsed = SupportTicketInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input", issues: parsed.error.issues }, { status: 400 });
  }
  const t = parsed.data;
  const admin = createAdminClient();

  const row = {
    external_ref: t.external_ref ?? null,
    dedupe_key: t.dedupe_key,
    account_user_id: t.account_user_id ?? null,
    category: t.category,
    severity: t.severity,
    product_area: t.product_area ?? null,
    plan: t.plan,
    channel: t.channel ?? null,
    status: t.status,
    reopened_count: t.reopened_count,
    first_response_at: t.first_response_at ?? null,
    resolved_at: t.resolved_at ?? null,
    ...(t.created_at ? { created_at: t.created_at } : {}),
    updated_at: new Date().toISOString(),
  };

  // Idempotent by external_ref when present (re-import = update, not a duplicate).
  const query = t.external_ref
    ? admin.from("support_tickets").upsert(row, { onConflict: "external_ref" }).select("id")
    : admin.from("support_tickets").insert(row).select("id");
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "write_failed" }, { status: 503 });

  await recordAdminAction({
    actorUserId: actorId,
    action: "support_ticket_import",
    targetUserId: t.account_user_id ?? null,
    reason: `support ticket ${t.category}/${t.severity} (${t.status})`,
  });

  return NextResponse.json({ ok: true, id: (data?.[0] as { id: string } | undefined)?.id ?? null });
}

export async function GET() {
  const actorId = await requireAdmin();
  if (!actorId) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const admin = createAdminClient();

  const [ticketsRes, exclusion, activatedRes, paidRes] = await Promise.all([
    admin
      .from("support_tickets")
      .select("dedupe_key, account_user_id, category, status, reopened_count, first_response_at, resolved_at, created_at"),
    readExclusionRegistry(admin),
    admin.from("analytics_activation_facts").select("user_id", { count: "exact", head: true }),
    admin
      .from("subscriptions")
      .select("user_id", { count: "exact", head: true })
      .eq("status", "active")
      .not("trial_used_at", "is", null),
  ]);

  // Fail closed: a ledger read error is UNAVAILABLE, never a zero burden.
  const available = !ticketsRes.error;
  // MW-07: verification is DURABLE evidence (a recent successful import covering
  // the current window) AND the operator attestation — an env flag alone no
  // longer certifies an empty ledger as a real zero.
  const coverage = await supportIngestionCoverage(admin);
  const envAttested = process.env.SUPPORT_INGESTION_VERIFIED === "1";
  const ingestionVerified = coverage.durableCoverageCurrent && envAttested;
  const burden = supportBurden({
    tickets: (ticketsRes.data ?? []) as SupportTicketRow[],
    activatedUsers: activatedRes.count ?? 0,
    paidUsers: paidRes.count ?? 0,
    excludedUserIds: exclusion.ids,
    available,
    ingestionVerified,
  });

  // MW-11: reconciliation aid — the ledger row count (deduped by issue is inside
  // `burden.contacts`) versus the raw imported rows, so an operator can compare
  // against the number of inbox items they reviewed WITHOUT any content leaving
  // the inbox. `ingestionVerified` states whether an empty ledger is a real zero.
  const ledgerRows = ticketsRes.data?.length ?? 0;
  return NextResponse.json({
    burden,
    exclusionsAvailable: exclusion.available,
    coverage: {
      ingestionVerified,
      ledgerRows,
      // MW-07: durable coverage evidence, so an operator can see WHY verification
      // is on/off — last import, the reviewed window, source, and staleness.
      durableCoverageCurrent: coverage.durableCoverageCurrent,
      lastImportAt: coverage.lastImportAt,
      coverageEnd: coverage.coverageEnd,
      source: coverage.source,
      stale: coverage.stale,
      envAttested,
    },
  });
}
