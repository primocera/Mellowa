import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isPassing,
  validateReleaseManifest,
  type ReleaseManifest,
} from "@/lib/release/manifest";
import { renderStatusPage } from "../scripts/render-release-status.mjs";

/**
 * MW-95-02: the current v16 release record.
 *
 * v13 is superseded and leaves the current tiers unassessed. v16 is a DRAFT — no
 * candidate is frozen yet — so no tier may carry an active verdict, and the human
 * status page must be a byte-for-byte render of the machine manifest so the two
 * can never drift. The immutable RC workflow (release-candidate.yml) is what
 * makes the authenticated gate fail closed independent of the mutable RC_GATE
 * variable, so the workflow source is contract-tested too.
 */

const V16_PATH = "docs/release/manifest.v16.json";
const STATUS_PATH = "docs/release/v16/STATUS.md";
const RC_WORKFLOW_PATH = ".github/workflows/release-candidate.yml";

function migrationsOnDisk(): string[] {
  return readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.slice(0, 3))
    .sort();
}

const manifest = JSON.parse(readFileSync(V16_PATH, "utf8")) as ReleaseManifest;

describe("the current v16 manifest", () => {
  it("is internally consistent and enumerates the COMPLETE on-disk migration set", () => {
    const violations = validateReleaseManifest(manifest, {
      migrationsOnDisk: migrationsOnDisk(),
    });
    expect(
      violations,
      `v16 manifest violations: ${violations.map((v) => `${v.rule}: ${v.message}`).join(" | ")}`,
    ).toEqual([]);
    expect(manifest.migrations).toEqual(migrationsOnDisk());
  });

  it("is a DRAFT with nothing frozen and no active verdict", () => {
    expect(manifest.candidateLifecycle).toBe("draft");
    expect(manifest.rcSha).toBeNull();
    for (const [tier, verdict] of Object.entries(manifest.verdicts)) {
      expect(["NO-GO", "UNASSESSED"], `${tier} must not be active in a draft`).toContain(
        verdict,
      );
    }
  });

  it("records no passing suite (a draft has no frozen evidence to certify)", () => {
    for (const s of manifest.suites) {
      expect(isPassing(s.status), `${s.id} claims a pass without a frozen candidate`).toBe(
        false,
      );
    }
  });

  it("keeps the P1 E2E gate OPEN because the prior run is superseded at HEAD, and keeps P0-LIVE open+accepted (MW-V18-01)", () => {
    const openIds = manifest.blockers.map((b) => b.id);
    const closedIds = (manifest.closedBlockers ?? []).map((b) => b.id);
    // The a59aa4e authenticated run is a TRUE historical pass, but product code
    // drifted past that SHA across the whole v17 pack, so it no longer certifies
    // HEAD. The candidate model requires the matrix observed AT the candidate, so
    // the blocker is OPEN again -- a superseded run is not a standing closure, and
    // an owner acceptance would be required (there is none) to ship over it.
    expect(openIds).toContain("P1-AUTH-E2E-AT-HEAD");
    expect(closedIds).not.toContain("P1-AUTH-E2E-AT-HEAD");
    const p1 = manifest.blockers.find((b) => b.id === "P1-AUTH-E2E-AT-HEAD");
    expect(p1?.acceptance).toMatch(/supersed/i);
    // No fabricated owner acceptance for the P1 -- it stays a hard open blocker.
    expect(
      (manifest.acceptedRisks ?? []).some((r) => r.blockerId === "P1-AUTH-E2E-AT-HEAD"),
      "the E2E blocker must not be silently accepted away",
    ).toBe(false);
    // P0-LIVE stays OPEN -- a P0 is never accepted away in the score -- but the
    // owner's carried-forward acceptance is recorded against it.
    expect(openIds).toContain("P0-LIVE-TRANSACTION");
    const risk = (manifest.acceptedRisks ?? []).find(
      (r) => r.blockerId === "P0-LIVE-TRANSACTION",
    );
    expect(risk, "owner acceptance for P0-LIVE must be recorded").toBeTruthy();
    expect(risk?.tiers).toContain("public_paid");
    expect(risk?.acceptedBy).not.toBe("Owner"); // must be a person, not a role
  });

  it("never presents a superseded owner run (ran at a different SHA than the candidate) as a closed blocker (MW-V18-01)", () => {
    // The exact contradiction M01 reconciles: an authenticated run recorded at a
    // SHA other than the current candidate (rcSha ?? baselineSha) cannot stand as
    // a closure -- accepted risk / stale evidence is not completion.
    const candidateSha = manifest.rcSha ?? manifest.baselineSha;
    const authRun = manifest.ownerEvidence.find((o) => o.id === "authenticated-e2e-matrix");
    expect(authRun).toBeTruthy();
    if (authRun && isPassing(authRun.status) && authRun.sha && authRun.sha !== candidateSha) {
      expect(
        (manifest.closedBlockers ?? []).some((b) => b.id === "P1-AUTH-E2E-AT-HEAD"),
        "a run at a superseded SHA must not close the E2E blocker",
      ).toBe(false);
      expect(manifest.blockers.some((b) => b.id === "P1-AUTH-E2E-AT-HEAD")).toBe(true);
    }
  });

  it("records the authenticated E2E matrix as a real local owner-run, but not the live rehearsal", () => {
    const byId = Object.fromEntries(manifest.ownerEvidence.map((o) => [o.id, o]));
    // The authenticated matrix was run locally against a seeded non-production
    // Supabase and passed -- recorded honestly as local_pass with SHA-pinned
    // evidence, NOT a workflow-frozen RC.
    expect(byId["authenticated-e2e-matrix"].status).toBe("local_pass");
    expect(byId["authenticated-e2e-matrix"].note).toMatch(/a59aa4e/);
    // The live-money rehearsal has NOT been recorded: a charge appearing in
    // Stripe is not the full charge-cancel-reactivate-recover-refund sequence.
    expect(isPassing(byId["live-transaction"].status), "live rehearsal must not claim a pass").toBe(
      false,
    );
  });
});

describe("the human status page is generated from the manifest", () => {
  it("matches a fresh render byte for byte (no hand edits, no drift)", () => {
    const onDisk = readFileSync(STATUS_PATH, "utf8");
    const fresh = renderStatusPage(manifest) + "\n";
    expect(onDisk).toBe(fresh);
  });

  it("does not state a verdict the manifest does not hold", () => {
    const page = readFileSync(STATUS_PATH, "utf8");
    for (const tier of ["automated_code_gate", "capped_beta", "public_paid"] as const) {
      expect(page).toContain(manifest.verdicts[tier]);
    }
    // A draft must never render a bare GO for a tier.
    expect(page).not.toMatch(/\|\s*GO\s*\|/);
  });
});

describe("the immutable RC workflow fails closed on skipped auth", () => {
  const wf = readFileSync(RC_WORKFLOW_PATH, "utf8");

  it("triggers only on explicit candidates (dispatch SHA or rc/* tag)", () => {
    expect(wf).toMatch(/workflow_dispatch:/);
    expect(wf).toMatch(/candidate_sha:/);
    expect(wf).toMatch(/tags:\s*\n\s*-\s*"rc\/\*"/);
  });

  it("requires the seeded auth environment and exits non-zero when it is absent", () => {
    // The load-bearing property: no dependence on the mutable RC_GATE variable
    // for the fail-closed decision — the workflow itself exits 1.
    // MW-V17-01: the gate is now a canonical preflight that lists missing secret
    // NAMES only (never values) and requires a Stripe TEST key.
    expect(wf).toMatch(/Preflight — require the canonical seeded environment/);
    expect(wf).toMatch(/exit 1/);
    // The auth matrix step must be present and not conditional on RC_GATE.
    expect(wf).toMatch(/Authenticated E2E matrix \(required\)/);
  });

  it("refuses live Stripe and production Supabase", () => {
    expect(wf).toMatch(/sk_live_\*/);
    expect(wf).toMatch(/Non-production guard/);
  });

  it("uses least-privilege permissions and pins the exact candidate SHA", () => {
    expect(wf).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(wf).toMatch(/ref:\s*\$\{\{\s*steps\.ref\.outputs\.sha\s*\}\}/);
  });

  it("validates the manifest and the status-page sync before any suite", () => {
    const validateIdx = wf.indexOf("Validate release manifest");
    const lintIdx = wf.indexOf("Lint");
    expect(validateIdx).toBeGreaterThan(-1);
    expect(lintIdx).toBeGreaterThan(validateIdx);
    expect(wf).toMatch(/render-release-status\.mjs .* --check/);
  });
});
