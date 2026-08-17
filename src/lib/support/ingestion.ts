import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * MW-07: derive support-ingestion coverage from DURABLE evidence (the
 * support_ingestion_runs ledger, migration 054) rather than an env flag alone.
 *
 * `durableCoverageCurrent` is true only when a successful import exists whose
 * coverage window ends within the staleness horizon — i.e. someone recently
 * reviewed the inbox and imported its metadata. The route combines this with the
 * SUPPORT_INGESTION_VERIFIED operator attestation, so an empty ledger, a stale
 * window or a missing attestation all keep burden UNAVAILABLE (never zero).
 */

export interface SupportIngestionCoverage {
  /** false when the ledger read itself failed — fail closed. */
  available: boolean;
  /** A recent successful import covers the current window. */
  durableCoverageCurrent: boolean;
  lastImportAt: string | null;
  coverageEnd: string | null;
  source: string | null;
  /** No run, or the newest run's coverage is older than the horizon. */
  stale: boolean;
}

const DEFAULT_STALENESS_DAYS = 14;

export async function supportIngestionCoverage(
  admin: SupabaseClient,
  opts: { stalenessDays?: number; now?: Date } = {}
): Promise<SupportIngestionCoverage> {
  const { data, error } = await admin
    .from("support_ingestion_runs")
    .select("source, coverage_end, created_at, imported_count, updated_count")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return {
      available: false,
      durableCoverageCurrent: false,
      lastImportAt: null,
      coverageEnd: null,
      source: null,
      stale: true,
    };
  }

  const run = data as
    | { source: string; coverage_end: string | null; created_at: string }
    | null;
  if (!run) {
    return {
      available: true,
      durableCoverageCurrent: false,
      lastImportAt: null,
      coverageEnd: null,
      source: null,
      stale: true,
    };
  }

  const now = opts.now ?? new Date();
  const horizonMs = (opts.stalenessDays ?? DEFAULT_STALENESS_DAYS) * 24 * 60 * 60 * 1000;
  // Prefer the operator-declared coverage window end; fall back to run time.
  const anchorIso = run.coverage_end
    ? `${run.coverage_end}T23:59:59Z`
    : run.created_at;
  const anchorMs = Date.parse(anchorIso);
  const current = Number.isFinite(anchorMs) && now.getTime() - anchorMs <= horizonMs;

  return {
    available: true,
    durableCoverageCurrent: current,
    lastImportAt: run.created_at,
    coverageEnd: run.coverage_end,
    source: run.source,
    stale: !current,
  };
}
