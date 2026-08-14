/**
 * MW-V18-06: safe, idempotent onboarding-completion backfill.
 *
 * Legacy users who finished onboarding before onboarding_completions existed
 * (migration 043) have no completion row, so they are invisible to activation
 * cohorts. This infers a completion for them from DURABLE wellbeing_profiles
 * evidence, without:
 *   - fabricating an original completion timestamp (we use the profile's
 *     updated_at — the strongest durable signal — and stamp inferred_at/source),
 *   - creating duplicates (insert is ON CONFLICT DO NOTHING; the primary key is
 *     the exactly-once authority, so a concurrent runtime completion and the
 *     backfill converge on one row),
 *   - emitting onboarding_completed analytics events or lifecycle emails
 *     (this writes DB rows only — no event/email side effects),
 *   - counting partial/abandoned profiles as completed.
 *
 * Pure planner + dependency-injected runner, so the batching, idempotency and
 * error-ledger behaviour is fully fixture-testable with no database.
 */

export const BACKFILL_DEFINITION_VERSION = "m06.1";

/** The durable evidence a legacy onboarding was actually completed. */
export interface ProfileRow {
  user_id: string;
  /** Set at the wizard's final step (defaults false) — the strongest "reached the end" marker. */
  safety_acknowledged: boolean | null;
  /** Chosen in an early required step; empty on an abandoned profile. */
  primary_goal: string | null;
  /** Strongest durable timestamp for when the completed state was written. */
  updated_at: string | null;
  created_at: string | null;
}

export type ProfileClass = "completed" | "partial";

/**
 * A profile is a completed onboarding only when the user explicitly acknowledged
 * safety AND chose a primary goal. Anything less is partial/abandoned and must
 * never be backfilled as a completion.
 */
export function classifyProfile(p: ProfileRow): ProfileClass {
  const acknowledged = p.safety_acknowledged === true;
  const hasGoal = typeof p.primary_goal === "string" && p.primary_goal.trim().length > 0;
  return acknowledged && hasGoal ? "completed" : "partial";
}

export interface CompletionInsert {
  user_id: string;
  /** Strongest durable timestamp — never a fabricated original completion time. */
  completed_at: string;
  source: "legacy_backfill";
  inferred_at: string;
  definition_version: string;
}

export interface BatchPlan {
  toInsert: CompletionInsert[];
  eligible: number;
  alreadyPresent: number;
  skippedPartial: number;
  /** Eligible rows with no usable durable timestamp — skipped, not invented. */
  skippedNoTimestamp: number;
}

/**
 * Plan one page: classify each profile, skip partial ones, skip those already
 * completed, and build the insert rows for the rest. Pure.
 */
export function planBatch(
  profiles: ProfileRow[],
  existing: Set<string>,
  nowIso: string
): BatchPlan {
  const plan: BatchPlan = {
    toInsert: [],
    eligible: 0,
    alreadyPresent: 0,
    skippedPartial: 0,
    skippedNoTimestamp: 0,
  };
  for (const p of profiles) {
    if (classifyProfile(p) === "partial") {
      plan.skippedPartial += 1;
      continue;
    }
    plan.eligible += 1;
    if (existing.has(p.user_id)) {
      plan.alreadyPresent += 1;
      continue;
    }
    // Strongest durable timestamp; never invent one.
    const completedAt = p.updated_at ?? p.created_at;
    if (!completedAt) {
      plan.skippedNoTimestamp += 1;
      continue;
    }
    plan.toInsert.push({
      user_id: p.user_id,
      completed_at: completedAt,
      source: "legacy_backfill",
      inferred_at: nowIso,
      definition_version: BACKFILL_DEFINITION_VERSION,
    });
  }
  return plan;
}

// --- dependency-injected runner ---------------------------------------------

export interface BackfillDeps {
  /** One page of profiles ordered by user_id > cursor (null = start), up to limit. */
  fetchProfilesPage(cursorUserId: string | null, limit: number): Promise<ProfileRow[]>;
  /** Which of these user ids already have a completion row. */
  fetchExistingCompletionIds(userIds: string[]): Promise<Set<string>>;
  /**
   * Insert rows with ON CONFLICT (user_id) DO NOTHING; return how many were
   * actually inserted (a concurrent runtime completion may absorb some).
   */
  insertCompletions(rows: CompletionInsert[]): Promise<number>;
}

export interface BackfillOptions {
  dryRun: boolean;
  batchSize?: number;
  /** Safety cap on pages processed in one invocation. */
  maxBatches?: number;
}

export interface BackfillReport {
  dryRun: boolean;
  definitionVersion: string;
  batches: number;
  eligible: number;
  /** Rows actually inserted (dry-run: what WOULD be inserted). */
  backfilled: number;
  alreadyPresent: number;
  skippedPartial: number;
  skippedNoTimestamp: number;
  failed: number;
  /** Per-batch failures: index + opaque code only, never PII. */
  errors: { batch: number; code: string }[];
  /** True when a page returned fewer than batchSize rows — nothing left to do. */
  completed: boolean;
}

const DEFAULT_BATCH = 200;
const DEFAULT_MAX_BATCHES = 10_000;

/**
 * Run (or dry-run) the backfill, resumable by user-id cursor and idempotent by
 * primary key. On an insert failure the batch is recorded in the error ledger
 * and the run continues — a poisoned page never aborts the whole job, and a
 * re-run picks up exactly what is still missing.
 */
export async function runOnboardingBackfill(
  deps: BackfillDeps,
  opts: BackfillOptions
): Promise<BackfillReport> {
  const limit = Math.max(1, opts.batchSize ?? DEFAULT_BATCH);
  const maxBatches = opts.maxBatches ?? DEFAULT_MAX_BATCHES;
  const report: BackfillReport = {
    dryRun: opts.dryRun,
    definitionVersion: BACKFILL_DEFINITION_VERSION,
    batches: 0,
    eligible: 0,
    backfilled: 0,
    alreadyPresent: 0,
    skippedPartial: 0,
    skippedNoTimestamp: 0,
    failed: 0,
    errors: [],
    completed: false,
  };

  let cursor: string | null = null;
  for (let i = 0; i < maxBatches; i++) {
    const page = await deps.fetchProfilesPage(cursor, limit);
    if (page.length === 0) {
      report.completed = true;
      break;
    }
    report.batches += 1;

    const existing = await deps.fetchExistingCompletionIds(page.map((p) => p.user_id));
    const nowIso = new Date().toISOString();
    const plan = planBatch(page, existing, nowIso);
    report.eligible += plan.eligible;
    report.alreadyPresent += plan.alreadyPresent;
    report.skippedPartial += plan.skippedPartial;
    report.skippedNoTimestamp += plan.skippedNoTimestamp;

    if (plan.toInsert.length > 0) {
      if (opts.dryRun) {
        report.backfilled += plan.toInsert.length; // what WOULD be inserted
      } else {
        try {
          report.backfilled += await deps.insertCompletions(plan.toInsert);
        } catch (e) {
          report.failed += plan.toInsert.length;
          report.errors.push({ batch: i, code: errorCode(e) });
        }
      }
    }

    // Advance the cursor past this page (ids are returned in ascending order).
    cursor = page[page.length - 1].user_id;
    if (page.length < limit) {
      report.completed = true;
      break;
    }
  }

  return report;
}

function errorCode(e: unknown): string {
  if (e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string") {
    return (e as { code: string }).code;
  }
  return "insert_failed";
}
