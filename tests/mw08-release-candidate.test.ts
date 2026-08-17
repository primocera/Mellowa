import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateReleaseManifest, type ReleaseManifest } from "@/lib/release/manifest";
import { renderStatusPage } from "../scripts/render-release-status.mjs";

/**
 * MW-08 (v20): a truthful, complete, NON-certified release candidate manifest,
 * an ordered migration plan, and additive/idempotent v20 migrations. No RC is
 * cut here and no verdict is claimed — those are owner/CI gates.
 */

function migrationsOnDisk(): string[] {
  return readdirSync("supabase/migrations")
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .map((f) => f.slice(0, 3))
    .sort();
}

const V20_PATH = "docs/release/manifest.v20.json";
const manifest = JSON.parse(readFileSync(V20_PATH, "utf8")) as ReleaseManifest;

describe("v20 release manifest", () => {
  it("validates and enumerates the COMPLETE on-disk migration set", () => {
    const violations = validateReleaseManifest(manifest, {
      migrationsOnDisk: migrationsOnDisk(),
    });
    expect(
      violations,
      `v20 manifest violations: ${violations.map((v) => `${v.rule}: ${v.message}`).join(" | ")}`
    ).toEqual([]);
    expect(manifest.migrations).toEqual(migrationsOnDisk());
    for (const m of ["050", "051", "052", "053", "054"]) {
      expect(manifest.migrations).toContain(m);
    }
  });

  it("is a DRAFT with no frozen RC and no active verdict (nothing certified)", () => {
    expect(manifest.candidateLifecycle).toBe("draft");
    expect(manifest.rcSha).toBeNull();
    for (const v of Object.values(manifest.verdicts)) {
      expect(v).toBe("UNASSESSED");
    }
  });

  it("keeps the migration-applied, RC and auth-matrix gates OPEN as owner blockers", () => {
    const ids = manifest.blockers.map((b) => b.id);
    expect(ids).toContain("P0-V20-MIGRATIONS-APPLIED");
    expect(ids).toContain("P0-V20-RC-NOT-CUT");
    expect(ids).toContain("P1-V20-AUTH-E2E-AT-HEAD");
  });

  it("records no owner evidence as done (all v20 owner actions NOT RUN)", () => {
    for (const e of manifest.ownerEvidence) {
      if (e.id !== "live-transaction") {
        expect(e.status, `${e.id} must not be marked done`).toBe("not_run");
      }
    }
  });

  it("the human STATUS page is a fresh render of the manifest (no drift)", () => {
    const onDisk = readFileSync("docs/release/v20/STATUS.md", "utf8");
    const fresh = renderStatusPage(manifest) + "\n";
    expect(onDisk).toBe(fresh);
  });
});

describe("v20 migrations are additive + idempotent with a rollback", () => {
  for (const m of ["050", "051", "052", "053", "054"]) {
    it(`migration ${m} is safe to (re-)apply and reversible`, () => {
      const dir = "supabase/migrations";
      const file = readdirSync(dir).find((f) => f.startsWith(m));
      expect(file, `migration ${m} on disk`).toBeTruthy();
      const sql = readFileSync(join(dir, file as string), "utf8").toLowerCase();
      // Idempotent DDL: create-if-not-exists / or-replace / add-column-if-not-
      // exists, OR the drop-if-exists-then-create pattern used for RLS policies
      // (which have no CREATE ... IF NOT EXISTS form).
      expect(
        /if not exists|or replace|add column if not exists|drop policy if exists/.test(sql),
        `${m} must use idempotent DDL`
      ).toBe(true);
      // A documented rollback.
      expect(/rollback/.test(sql), `${m} must document a rollback`).toBe(true);
    });
  }
});

describe("v20 migration plan is executable truth", () => {
  const plan = readFileSync("docs/release/v20/MIGRATION_PLAN.md", "utf8");
  it("references every v20 migration with preflight/apply/verify/rollback", () => {
    for (const m of ["050", "051", "052", "053", "054"]) {
      expect(plan).toContain(m);
    }
    for (const step of ["Preflight", "Apply", "Verify", "Rollback"]) {
      expect(plan).toContain(step);
    }
  });
  it("states the deploy-after-migrate ordering invariant and keeps prod owner-only", () => {
    expect(plan).toMatch(/must NOT be deployed before the schema exists/i);
    expect(plan).toMatch(/OWNER-ONLY|owner-only/);
    expect(plan).toMatch(/does not apply production migrations|does not apply/i);
  });
});
