import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCandidate, deriveVerdicts } from "../scripts/candidate-lib.mjs";

/**
 * MW-V18-02 workflow/contract tests. These exercise the ACTUAL scripts the RC
 * workflow runs (`emit-rc-run-summary`, `freeze-candidate`, `promote-candidate`)
 * plus the workflow YAML itself, against the failure modes the design enumerates:
 * missing secret, zero tests, failing auth journey, wrong SHA, local provenance,
 * missing evidence, tampered hash, partial suites, production gate absent/present,
 * duplicate freeze, superseded candidate and a successful promotion.
 */

const REPO = process.cwd();
const HEAD = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const MANIFEST = JSON.parse(readFileSync("docs/release/manifest.v16.json", "utf8"));
const sha256 = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "rc-contract-"));
});
afterAll(() => {
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

/** Run a repo script; return { status, stdout, stderr } without throwing. */
function run(script: string, args: string[], env: Record<string, string | undefined> = {}) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      cwd: REPO,
      env: { ...process.env, GITHUB_RUN_ID: undefined, ...env },
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      status: e.status ?? 1,
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? "",
    };
  }
}

/** A good authenticated-matrix evidence file, pinned to a given SHA. */
function writeAuthEvidence(sha: string, totals: { total: number; passed: number; failed: number; skipped: number }) {
  const p = join(dir, `auth-${sha.slice(0, 7)}-${totals.total}-${totals.failed}.json`);
  writeFileSync(p, JSON.stringify({ sha, generatedAtUtc: "2026-08-13T00:00:00Z", totals }, null, 2));
  return p;
}

/** A run summary for freeze. */
function writeSummary(suitesList: unknown[], sha = HEAD) {
  const p = join(dir, `summary-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(p, JSON.stringify({ sha, runId: "test", environmentClass: "non_production", suites: suitesList }, null, 2));
  return p;
}

const CODE_SUITES = [
  { id: "lint", result: "pass" },
  { id: "typecheck", result: "pass" },
  { id: "unit-contract-safety", result: "pass" },
  { id: "eval-gate", result: "pass" },
  { id: "production-build", result: "pass" },
  { id: "e2e-public", result: "pass" },
];

describe("the RC workflow YAML encodes the fixed contract", () => {
  const yaml = readFileSync(".github/workflows/release-candidate.yml", "utf8");

  it("runs the authenticated matrix once — no duplicate bare `npm run test:e2e`", () => {
    expect(yaml).toContain("npm run test:e2e:matrix");
    // The bare full-suite runner must be gone from the authenticated step.
    expect(yaml).not.toMatch(/^\s*npm run test:e2e\s*$/m);
  });

  it("never points the non-production RC at the live public origin", () => {
    expect(yaml).not.toMatch(/NEXT_PUBLIC_APP_URL:\s*https:\/\/mellowa\.app/);
    expect(yaml).toContain("E2E_APP_URL");
    // And it actively refuses the live origin in the guard.
    expect(yaml).toContain("Production URL refused");
  });

  it("freezes from a run summary, not a blanket mark-green", () => {
    expect(yaml).toContain("emit-rc-run-summary.mjs");
    expect(yaml).toContain("--run-summary");
    expect(yaml).not.toContain("--mark-code-green");
  });

  it("still fails closed on a missing seeded secret before any test runs", () => {
    expect(yaml).toContain("missing required secret");
    expect(yaml).toMatch(/E2E_SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe("emit-rc-run-summary", () => {
  it("refuses to emit when the authenticated evidence is missing", () => {
    const r = run("scripts/emit-rc-run-summary.mjs", [
      "--out", join(dir, "s.json"),
      "--sha", HEAD,
      "--auth-evidence", join(dir, "does-not-exist.json"),
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/evidence .* is missing/i);
  });

  it("writes a summary that lists the auth journey but never release-check", () => {
    const ev = writeAuthEvidence(HEAD, { total: 40, passed: 40, failed: 0, skipped: 0 });
    const out = join(dir, "summary-emitted.json");
    const r = run("scripts/emit-rc-run-summary.mjs", ["--out", out, "--sha", HEAD, "--auth-evidence", ev]);
    expect(r.status).toBe(0);
    const summary = JSON.parse(readFileSync(out, "utf8"));
    const ids = summary.suites.map((s: { id: string }) => s.id);
    expect(ids).toContain("e2e-authenticated");
    expect(ids).not.toContain("release-check");
  });
});

describe("freeze-candidate records passes honestly", () => {
  it("freezes a clean workflow candidate; auth recorded, release-check left blocked", () => {
    const ev = writeAuthEvidence(HEAD, { total: 40, passed: 40, failed: 0, skipped: 0 });
    const summary = writeSummary([...CODE_SUITES, { id: "e2e-authenticated", result: "pass", evidence: ev }]);
    const out = join(dir, "cand-ok.json");
    const r = run("scripts/freeze-candidate.mjs", ["--sha", HEAD, "--run-summary", summary, "--out", out], {
      GITHUB_RUN_ID: "999",
    });
    expect(r.status, r.stderr).toBe(0);
    const cand = JSON.parse(readFileSync(out, "utf8"));
    expect(cand.runProvenance).toBe("workflow");
    const auth = cand.suites.find((s: { id: string }) => s.id === "e2e-authenticated");
    const rc = cand.suites.find((s: { id: string }) => s.id === "release-check");
    expect(auth.status).toBe("ci_pass");
    expect(auth.sha).toBe(HEAD);
    expect(rc.status).not.toMatch(/pass/); // never fabricated
    // Code gate green even though release-check is blocked.
    expect(cand.verdicts.automated_code_gate).toBe("GO");
  });

  it("REFUSES a run summary that marks the production-only release-check green", () => {
    const ev = writeAuthEvidence(HEAD, { total: 40, passed: 40, failed: 0, skipped: 0 });
    const summary = writeSummary([
      ...CODE_SUITES,
      { id: "e2e-authenticated", result: "pass", evidence: ev },
      { id: "release-check", result: "pass" },
    ]);
    const r = run("scripts/freeze-candidate.mjs", ["--sha", HEAD, "--run-summary", summary, "--out", join(dir, "x.json")], {
      GITHUB_RUN_ID: "999",
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/production-owner suite/i);
  });

  it("fails when the authenticated matrix discovered zero tests", () => {
    const ev = writeAuthEvidence(HEAD, { total: 0, passed: 0, failed: 0, skipped: 0 });
    const summary = writeSummary([...CODE_SUITES, { id: "e2e-authenticated", result: "pass", evidence: ev }]);
    const r = run("scripts/freeze-candidate.mjs", ["--sha", HEAD, "--run-summary", summary, "--out", join(dir, "z.json")], {
      GITHUB_RUN_ID: "999",
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/non-zero run|zero-test/i);
  });

  it("fails when the authenticated matrix reported failures", () => {
    const ev = writeAuthEvidence(HEAD, { total: 40, passed: 38, failed: 2, skipped: 0 });
    const summary = writeSummary([...CODE_SUITES, { id: "e2e-authenticated", result: "pass", evidence: ev }]);
    const r = run("scripts/freeze-candidate.mjs", ["--sha", HEAD, "--run-summary", summary, "--out", join(dir, "f.json")], {
      GITHUB_RUN_ID: "999",
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/clean non-zero run/i);
  });

  it("fails when the auth evidence file is missing entirely", () => {
    const summary = writeSummary([
      ...CODE_SUITES,
      { id: "e2e-authenticated", result: "pass", evidence: join(dir, "nope.json") },
    ]);
    const r = run("scripts/freeze-candidate.mjs", ["--sha", HEAD, "--run-summary", summary, "--out", join(dir, "m.json")], {
      GITHUB_RUN_ID: "999",
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/evidence file .* is missing/i);
  });

  it("refuses a candidate SHA that is not the checked-out HEAD", () => {
    const summary = writeSummary(CODE_SUITES, "b".repeat(40));
    const r = run("scripts/freeze-candidate.mjs", ["--sha", "b".repeat(40), "--run-summary", summary, "--out", join(dir, "w.json")]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/not the checked-out HEAD/i);
  });

  it("refuses a duplicate freeze over an existing candidate file (immutable)", () => {
    const ev = writeAuthEvidence(HEAD, { total: 40, passed: 40, failed: 0, skipped: 0 });
    const summary = writeSummary([...CODE_SUITES, { id: "e2e-authenticated", result: "pass", evidence: ev }]);
    const out = join(dir, "dup.json");
    const first = run("scripts/freeze-candidate.mjs", ["--sha", HEAD, "--run-summary", summary, "--out", out], { GITHUB_RUN_ID: "999" });
    expect(first.status, first.stderr).toBe(0);
    // A frozen candidate is immutable: a second freeze to the same path is
    // refused (the artifact differs at least by its fresh timestamp/run id).
    const conflict = run("scripts/freeze-candidate.mjs", ["--sha", HEAD, "--run-summary", summary, "--out", out], { GITHUB_RUN_ID: "1000" });
    expect(conflict.status).not.toBe(0);
    expect(conflict.stderr).toMatch(/immutable|Refusing to overwrite/i);
  });
});

describe("promote-candidate verifies provenance, HEAD, evidence and lifecycle", () => {
  // Build a valid workflow candidate at the real HEAD from the real manifest, so
  // its derived verdicts match what promote recomputes.
  function makeCandidate(opts: {
    provenance?: string;
    lifecycle?: string;
    evidencePath?: string;
    artifactHash?: string;
  } = {}) {
    const evidence = opts.evidencePath;
    const suitesList = MANIFEST.suites.map((s: { id: string; command: string; required: boolean; status: string }) => {
      const cls = s.id === "e2e-authenticated" ? "auth_journey" : s.id === "release-check" ? "production_owner" : "code";
      if (cls === "production_owner") {
        return { id: s.id, command: s.command, required: true, status: "blocked", suiteClass: cls };
      }
      const rec: Record<string, unknown> = {
        id: s.id,
        command: s.command,
        required: true,
        status: "ci_pass",
        sha: HEAD,
        evidence: cls === "auth_journey" ? evidence ?? "docs/release/evidence/auth.json" : "workflow-run:test",
        suiteClass: cls,
      };
      if (opts.artifactHash && cls === "code" && s.id === "e2e-public") rec.artifactHash = opts.artifactHash;
      return rec;
    });
    const evidenceHashes: Record<string, string> = {};
    if (opts.artifactHash && evidence) evidenceHashes[evidence] = opts.artifactHash;
    const cand = buildCandidate(
      { ...MANIFEST, rcSha: HEAD, candidateLifecycle: "frozen" },
      {
        rcSha: HEAD,
        runId: "test",
        runProvenance: opts.provenance ?? "workflow",
        generatedAtUtc: "2026-08-13T00:00:00Z",
        environmentClass: "non_production",
        rollbackTarget: "6fe3980",
        suites: suitesList,
        evidenceHashes,
        manifestValid: true,
      },
    );
    if (opts.lifecycle) {
      cand.candidateLifecycle = opts.lifecycle;
      cand.verdicts = deriveVerdicts({ ...MANIFEST, suites: suitesList, rcSha: HEAD, candidateLifecycle: opts.lifecycle });
    }
    const p = join(dir, `cand-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(p, JSON.stringify(cand, null, 2));
    return p;
  }

  it("promotes a clean workflow candidate at HEAD (dry run) and writes a proposal", () => {
    const cand = makeCandidate();
    const dry = run("scripts/promote-candidate.mjs", ["--candidate", cand]);
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toMatch(/promotable/i);
    const outProp = join(dir, "proposed.json");
    const wr = run("scripts/promote-candidate.mjs", ["--candidate", cand, "--write", "--out", outProp]);
    expect(wr.status, wr.stderr).toBe(0);
    const proposed = JSON.parse(readFileSync(outProp, "utf8"));
    expect(proposed.candidateLifecycle).toBe("promoted");
    expect(proposed.rcSha).toBe(HEAD);
    // Verdicts are derived, and paid is never active without owner evidence.
    expect(proposed.verdicts.public_paid).not.toBe("GO");
  });

  it("rejects a local-provenance candidate", () => {
    const cand = makeCandidate({ provenance: "local" });
    const r = run("scripts/promote-candidate.mjs", ["--candidate", cand]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/provenance/i);
  });

  it("rejects a superseded candidate", () => {
    const cand = makeCandidate({ lifecycle: "superseded" });
    const r = run("scripts/promote-candidate.mjs", ["--candidate", cand]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/superseded|not "frozen"/i);
  });

  it("detects a tampered evidence hash", () => {
    const evPath = join(dir, "tamper-evidence.txt");
    writeFileSync(evPath, "the real evidence bytes");
    const wrongHash = sha256("some other content entirely");
    const cand = makeCandidate({ evidencePath: undefined, artifactHash: wrongHash });
    // makeCandidate put the artifactHash on e2e-public but its evidence is
    // "workflow-run:test" (not a file); point it at the real file instead.
    const obj = JSON.parse(readFileSync(cand, "utf8"));
    const pub = obj.suites.find((s: { id: string }) => s.id === "e2e-public");
    pub.evidence = evPath;
    pub.artifactHash = wrongHash;
    obj.evidenceHashes = { [evPath]: wrongHash };
    writeFileSync(cand, JSON.stringify(obj, null, 2));
    const r = run("scripts/promote-candidate.mjs", ["--candidate", cand]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/tamper/i);
  });
});
