import { describe, expect, it, vi } from "vitest";
import {
  classifyProfile,
  planBatch,
  runOnboardingBackfill,
  BACKFILL_DEFINITION_VERSION,
  type ProfileRow,
  type BackfillDeps,
  type CompletionInsert,
} from "@/lib/onboarding/backfill";

/**
 * MW-V18-06: the onboarding backfill infers completions from durable evidence
 * without fabricating timestamps, duplicating rows, counting partial profiles,
 * or aborting on a poisoned page. Dry-run writes nothing; a re-run is idempotent.
 */

const profile = (over: Partial<ProfileRow>): ProfileRow => ({
  user_id: "u",
  safety_acknowledged: true,
  primary_goal: "energy",
  updated_at: "2026-07-01T00:00:00Z",
  created_at: "2026-06-01T00:00:00Z",
  ...over,
});

describe("classifyProfile", () => {
  it("completed requires safety acknowledged AND a primary goal", () => {
    expect(classifyProfile(profile({}))).toBe("completed");
    expect(classifyProfile(profile({ safety_acknowledged: false }))).toBe("partial");
    expect(classifyProfile(profile({ safety_acknowledged: null }))).toBe("partial");
    expect(classifyProfile(profile({ primary_goal: "" }))).toBe("partial");
    expect(classifyProfile(profile({ primary_goal: "   " }))).toBe("partial");
    expect(classifyProfile(profile({ primary_goal: null }))).toBe("partial");
  });
});

describe("planBatch", () => {
  it("skips partial, skips already-present, inserts the rest with the durable timestamp", () => {
    const profiles = [
      profile({ user_id: "a" }), // completed, new
      profile({ user_id: "b" }), // completed, already present
      profile({ user_id: "c", safety_acknowledged: false }), // partial
    ];
    const plan = planBatch(profiles, new Set(["b"]), "2026-08-14T00:00:00Z");
    expect(plan.eligible).toBe(2);
    expect(plan.alreadyPresent).toBe(1);
    expect(plan.skippedPartial).toBe(1);
    expect(plan.toInsert).toHaveLength(1);
    const row = plan.toInsert[0];
    expect(row.user_id).toBe("a");
    // Strongest durable timestamp = updated_at, NOT a fabricated "now".
    expect(row.completed_at).toBe("2026-07-01T00:00:00Z");
    expect(row.source).toBe("legacy_backfill");
    expect(row.inferred_at).toBe("2026-08-14T00:00:00Z");
    expect(row.definition_version).toBe(BACKFILL_DEFINITION_VERSION);
  });

  it("falls back to created_at, and never invents a timestamp", () => {
    const withUpdated = planBatch([profile({ user_id: "a", updated_at: null })], new Set(), "N");
    expect(withUpdated.toInsert[0].completed_at).toBe("2026-06-01T00:00:00Z");

    const noTimestamp = planBatch(
      [profile({ user_id: "a", updated_at: null, created_at: null })],
      new Set(),
      "N"
    );
    expect(noTimestamp.toInsert).toHaveLength(0);
    expect(noTimestamp.skippedNoTimestamp).toBe(1);
    expect(noTimestamp.eligible).toBe(1);
  });
});

/** Build deps over an in-memory profile list and a mutable "already present" set. */
function memoryDeps(
  profiles: ProfileRow[],
  present: Set<string>,
  insert?: (rows: CompletionInsert[]) => number
): { deps: BackfillDeps; inserted: CompletionInsert[] } {
  const inserted: CompletionInsert[] = [];
  const deps: BackfillDeps = {
    async fetchProfilesPage(cursor, limit) {
      const start = cursor ? profiles.findIndex((p) => p.user_id > cursor) : 0;
      if (start < 0) return [];
      return profiles.slice(start, start + limit);
    },
    async fetchExistingCompletionIds(ids) {
      return new Set(ids.filter((id) => present.has(id)));
    },
    async insertCompletions(rows) {
      if (insert) return insert(rows);
      for (const r of rows) {
        inserted.push(r);
        present.add(r.user_id);
      }
      return rows.length;
    },
  };
  return { deps, inserted };
}

describe("runOnboardingBackfill", () => {
  const three = ["a", "b", "c"].map((user_id) => profile({ user_id }));

  it("dry-run writes nothing but reports what would be backfilled", async () => {
    const present = new Set<string>();
    const insert = vi.fn(() => 0);
    const { deps } = memoryDeps(three, present, insert);
    const r = await runOnboardingBackfill(deps, { dryRun: true, batchSize: 2 });
    expect(insert).not.toHaveBeenCalled();
    expect(r.backfilled).toBe(3);
    expect(present.size).toBe(0);
    expect(r.completed).toBe(true);
  });

  it("real run inserts across pages and is idempotent on re-run", async () => {
    const present = new Set<string>();
    const { deps } = memoryDeps(three, present, undefined);
    const first = await runOnboardingBackfill(deps, { dryRun: false, batchSize: 2 });
    expect(first.backfilled).toBe(3);
    expect(first.batches).toBe(2); // 2 + 1
    expect(present).toEqual(new Set(["a", "b", "c"]));

    // Re-run: everything already present → nothing inserted.
    const second = await runOnboardingBackfill(deps, { dryRun: false, batchSize: 2 });
    expect(second.backfilled).toBe(0);
    expect(second.alreadyPresent).toBe(3);
  });

  it("ON CONFLICT absorb: backfilled reflects rows actually inserted", async () => {
    // insertCompletions reports fewer inserts than requested (a concurrent
    // runtime completion absorbed one), so backfilled must not over-count.
    const present = new Set<string>();
    const { deps } = memoryDeps(three, present, (rows) => rows.length - 1);
    const r = await runOnboardingBackfill(deps, { dryRun: false, batchSize: 10 });
    expect(r.eligible).toBe(3);
    expect(r.backfilled).toBe(2); // 3 requested, 2 actually inserted
    expect(r.failed).toBe(0);
  });

  it("records an insert failure and continues (poisoned page never aborts)", async () => {
    let call = 0;
    const present = new Set<string>();
    const { deps } = memoryDeps(three, present, () => {
      call += 1;
      if (call === 1) throw Object.assign(new Error("boom"), { code: "23514" });
      return 1;
    });
    const r = await runOnboardingBackfill(deps, { dryRun: false, batchSize: 1 });
    expect(r.batches).toBe(3);
    expect(r.failed).toBe(1);
    expect(r.errors).toEqual([{ batch: 0, code: "23514" }]);
    expect(r.backfilled).toBe(2); // batches 2 and 3 succeeded
  });
});
