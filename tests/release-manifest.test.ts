import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isPassing,
  summarizeManifest,
  validateReleaseManifest,
  type ReleaseManifest,
  type ManifestViolation,
} from "@/lib/release/manifest";

/**
 * MW-V11-00: the release manifest is the single source of release truth, and
 * this file is what stops it becoming another document that agrees with
 * whatever the reader hoped.
 *
 * Every fixture below is a way the v10 record actually went wrong, or a way it
 * plausibly could have: a green claim carried forward from a commit that is no
 * longer the head, the same suite reported twice with different outcomes, a
 * headline count with no artifact behind it, counts that do not add up, a
 * required suite skipped, and a GO issued over an open P0.
 */

const REAL_MANIFEST_PATH = "docs/release/manifest.v11.json";
const SHA = "169c706683a821054351f45a5916f667ea93557c";
const OTHER_SHA = "e817aa4f4bdc3f0a9eeed0d30e3210aa2c1d968f";

/** A minimal manifest that passes every rule. Fixtures below mutate a copy. */
const validManifest = (): ReleaseManifest => ({
  schema: 1,
  release: "test",
  baselineSha: SHA,
  rcSha: null,
  reconciledAtUtc: "2026-07-26T19:05:00Z",
  buildId: null,
  migrations: ["001"],
  suites: [
    {
      id: "unit",
      command: "npx vitest run",
      required: true,
      status: "local_pass",
      sha: SHA,
      counts: { total: 10, passed: 10, failed: 0, skipped: 0 },
      evidence: "docs/release/evidence/test/unit.txt",
    },
  ],
  ownerEvidence: [
    { id: "live-transaction", action: "One real transaction.", status: "not_run" },
  ],
  blockers: [
    {
      id: "P0-LIVE",
      level: "P0",
      title: "No live transaction.",
      owner: "Owner",
      blocks: ["public_paid"],
      acceptance: "Recorded owner evidence.",
    },
  ],
  verdicts: {
    automated_code_gate: "CONDITIONAL GO",
    capped_beta: "CONDITIONAL GO",
    public_paid: "NO-GO",
  },
  rollback: "Flag-based; every migration is additive.",
  documents: [],
});

const rules = (violations: ManifestViolation[]) => violations.map((v) => v.rule);

describe("the validator accepts an honest manifest", () => {
  it("passes a manifest whose claims all carry evidence at the right SHA", () => {
    expect(validateReleaseManifest(validManifest())).toEqual([]);
  });

  it("accepts unrun and blocked checks — absence of evidence is not a violation", () => {
    const m = validManifest();
    m.suites.push(
      { id: "e2e-auth", command: "npm run test:e2e", required: true, status: "not_run" },
      { id: "release-check", command: "npm run release-check", required: true, status: "blocked" },
    );
    // Honest "we did not run this" must never be a validation failure. The
    // pressure to mark it green is exactly what the vocabulary exists to resist.
    expect(validateReleaseManifest(m)).toEqual([]);
  });

  it("refuses to summarize an invalid manifest reassuringly", () => {
    const m = validManifest();
    m.suites[0].evidence = undefined;
    expect(summarizeManifest(m)).toMatch(/^INVALID/);
    expect(summarizeManifest(validManifest())).toContain("public paid NO-GO");
  });
});

describe("stale SHA", () => {
  it("fails a pass carried forward from an earlier commit", () => {
    const m = validManifest();
    m.suites[0].sha = OTHER_SHA;
    const v = validateReleaseManifest(m);
    expect(rules(v)).toContain("stale_sha");
    expect(v[0].message).toContain("e817aa4");
  });

  it("fails a pass that does not say which commit it ran at", () => {
    const m = validManifest();
    delete m.suites[0].sha;
    expect(rules(validateReleaseManifest(m))).toContain("stale_sha");
  });

  it("measures staleness against the frozen RC once one exists", () => {
    const m = validManifest();
    m.rcSha = OTHER_SHA;
    // The suite ran at the baseline, but the candidate is now a different
    // commit, so the result no longer describes what would ship.
    expect(rules(validateReleaseManifest(m))).toContain("stale_sha");

    m.suites[0].sha = OTHER_SHA;
    expect(validateReleaseManifest(m)).toEqual([]);
  });
});

describe("contradictory status", () => {
  it("fails a suite reported twice with different outcomes", () => {
    // This is the v10 defect exactly: test:e2e:journey was listed as "not run"
    // one row above a row reporting it green.
    const m = validManifest();
    m.suites.push({
      id: "unit",
      command: "npx vitest run",
      required: true,
      status: "not_run",
    });
    const v = validateReleaseManifest(m);
    expect(rules(v)).toContain("contradictory_status");
    expect(v.some((x) => x.message.includes("different statuses"))).toBe(true);
  });

  it("fails a pass that also reports failures", () => {
    const m = validManifest();
    m.suites[0].counts = { total: 10, passed: 9, failed: 1, skipped: 0 };
    expect(rules(validateReleaseManifest(m))).toContain("contradictory_status");
  });

  it("fails a failure that reports no failures", () => {
    const m = validManifest();
    m.suites[0].status = "failed";
    m.suites[0].counts = { total: 10, passed: 10, failed: 0, skipped: 0 };
    expect(rules(validateReleaseManifest(m))).toContain("contradictory_status");
  });
});

describe("missing raw evidence", () => {
  it("fails a headline number with no artifact behind it", () => {
    const m = validManifest();
    m.suites[0].evidence = "   ";
    expect(rules(validateReleaseManifest(m))).toContain("missing_raw_evidence");
  });

  it("fails owner evidence claimed as rehearsed with nothing recorded", () => {
    const m = validManifest();
    m.ownerEvidence[0].status = "live_rehearsed";
    expect(rules(validateReleaseManifest(m))).toContain("missing_raw_evidence");
  });
});

describe("impossible count", () => {
  it("fails counts that do not add up", () => {
    const m = validManifest();
    m.suites[0].counts = { total: 100, passed: 10, failed: 0, skipped: 0 };
    expect(rules(validateReleaseManifest(m))).toContain("impossible_count");
  });

  it("fails a negative count", () => {
    const m = validManifest();
    m.suites[0].counts = { total: 10, passed: 12, failed: -2, skipped: 0 };
    expect(rules(validateReleaseManifest(m))).toContain("impossible_count");
  });

  it("fails a green suite in which nothing actually passed", () => {
    const m = validManifest();
    // All skipped, reported as a pass — the "green because nothing ran" shape.
    m.suites[0].counts = { total: 10, passed: 0, failed: 0, skipped: 10 };
    expect(rules(validateReleaseManifest(m))).toContain("impossible_count");
  });
});

describe("skipped required suite", () => {
  it("fails a GO verdict that rests on a required suite nobody ran", () => {
    const m = validManifest();
    m.blockers = [];
    m.verdicts.public_paid = "GO";
    m.rcSha = SHA;
    m.suites.push({
      id: "e2e-auth",
      command: "npm run test:e2e",
      required: true,
      status: "skipped",
    });
    const v = validateReleaseManifest(m);
    expect(rules(v)).toContain("skipped_required_suite");
  });

  it("allows an optional suite to be skipped under any verdict", () => {
    const m = validManifest();
    m.suites.push({
      id: "eval-live",
      command: "node scripts/eval-live.mjs",
      required: false,
      status: "skipped",
    });
    expect(validateReleaseManifest(m)).toEqual([]);
  });
});

describe("open P0 and unfrozen candidates", () => {
  it("fails GO on a tier that an open P0 blocks", () => {
    const m = validManifest();
    m.rcSha = SHA;
    m.verdicts.public_paid = "GO";
    const v = validateReleaseManifest(m);
    expect(rules(v)).toContain("open_p0");
  });

  it("fails GO on a tier that an open P1 blocks", () => {
    const m = validManifest();
    m.rcSha = SHA;
    m.blockers = [
      {
        id: "P1-AUTH-E2E",
        level: "P1",
        title: "Authenticated E2E not run at head.",
        owner: "Eng",
        blocks: ["public_paid"],
        acceptance: "preview_pass at the candidate SHA.",
      },
    ];
    m.verdicts.public_paid = "GO";
    expect(rules(validateReleaseManifest(m))).toContain("open_p0");
  });

  it("lets a P0 that blocks only public paid leave the beta tier alone", () => {
    const m = validManifest();
    m.rcSha = SHA;
    m.verdicts.capped_beta = "GO";
    // The single blocker blocks public_paid only.
    expect(validateReleaseManifest(m)).toEqual([]);
  });

  it("fails a GO issued when no candidate is frozen", () => {
    const m = validManifest();
    m.blockers = [];
    m.verdicts.capped_beta = "GO";
    expect(rules(validateReleaseManifest(m))).toContain("unfrozen_candidate");
  });

  it("fails a blocker with no owner", () => {
    const m = validManifest();
    m.blockers[0].owner = "  ";
    expect(rules(validateReleaseManifest(m))).toContain("malformed");
  });
});

describe("closed blockers keep their history", () => {
  const closed = () => ({
    id: "P1-COPY",
    level: "P1" as const,
    title: "Ungrammatical commercial copy.",
    owner: "Eng",
    blocks: ["public_paid" as const],
    acceptance: "Grammatical on every surface.",
    closedBy: "MW-V11-01",
    evidence: "docs/release/evidence/v11/e2e-public.txt",
  });

  it("accepts a closure that names what closed it and what proves it", () => {
    const m = validManifest();
    m.closedBlockers = [closed()];
    expect(validateReleaseManifest(m)).toEqual([]);
  });

  it("fails a blocker listed as both open and closed", () => {
    const m = validManifest();
    const item = closed();
    m.closedBlockers = [item];
    m.blockers.push({ ...item });
    expect(rules(validateReleaseManifest(m))).toContain("contradictory_status");
  });

  it("fails a closure with no evidence behind it", () => {
    const m = validManifest();
    m.closedBlockers = [{ ...closed(), evidence: "  " }];
    expect(rules(validateReleaseManifest(m))).toContain("missing_raw_evidence");
  });

  it("fails a closure that does not say what closed it", () => {
    const m = validManifest();
    m.closedBlockers = [{ ...closed(), closedBy: "" }];
    expect(rules(validateReleaseManifest(m))).toContain("malformed");
  });
});

describe("the release record carries no sensitive content", () => {
  it.each([
    ["an email address", "delivered to primoz@example.com"],
    ["a Stripe secret key", "used sk_live_ABCDEF123456"],
    ["a webhook secret", "whsec_ABCDEF123456"],
    ["a bearer token", "curl -H 'Bearer abc.def.ghi'"],
  ])("fails evidence containing %s", (_what, value) => {
    const m = validManifest();
    m.suites[0].evidence = value;
    expect(rules(validateReleaseManifest(m))).toContain("sensitive_reference");
  });

  it("accepts a safe path, run id or URL", () => {
    const m = validManifest();
    m.suites[0].evidence = "docs/release/evidence/v11/vitest.txt (run 20260726T190500Z)";
    expect(validateReleaseManifest(m)).toEqual([]);
  });
});

describe("malformed manifests are rejected rather than half-read", () => {
  it("fails an abbreviated SHA", () => {
    const m = validManifest();
    m.baselineSha = "169c706";
    expect(rules(validateReleaseManifest(m))).toContain("malformed");
  });

  it("fails a timestamp that is not explicit UTC", () => {
    const m = validManifest();
    m.reconciledAtUtc = "2026-07-26 21:05";
    expect(rules(validateReleaseManifest(m))).toContain("malformed");
  });

  it("fails an unknown status word", () => {
    const m = validManifest();
    // "green" is precisely the word the vocabulary exists to forbid.
    (m.suites[0] as { status: string }).status = "green";
    expect(rules(validateReleaseManifest(m))).toContain("malformed");
  });
});

describe("the real v11 manifest", () => {
  const manifest = JSON.parse(readFileSync(REAL_MANIFEST_PATH, "utf8")) as ReleaseManifest;

  it("is internally consistent", () => {
    const violations = validateReleaseManifest(manifest);
    expect(
      violations,
      `manifest violations: ${violations.map((v) => `${v.rule}: ${v.message}`).join(" | ")}`,
    ).toEqual([]);
  });

  it("records the reviewed baseline and, once frozen, a real candidate", () => {
    expect(manifest.baselineSha).toBe(SHA);
    // MW-V11-08 froze the candidate. Before that this asserted rcSha was null;
    // now the rule is that a frozen candidate must be a real 40-character SHA
    // and must not be the baseline it was cut from.
    if (manifest.rcSha !== null) {
      expect(manifest.rcSha).toMatch(/^[0-9a-f]{40}$/);
      expect(manifest.rcSha).not.toBe(manifest.baselineSha);
    }
    expect(manifest.verdicts.public_paid).toBe("NO-GO");
  });

  it("keeps every passing claim tied to a raw artifact that exists", () => {
    for (const suite of manifest.suites) {
      if (!isPassing(suite.status)) continue;
      if (!suite.evidence?.startsWith("docs/")) continue;
      const path = suite.evidence.split(" ")[0];
      expect(() => readFileSync(path, "utf8"), `${suite.id}: ${path} missing`).not.toThrow();
    }
  });

  it("names every migration present in the repository", () => {
    const onDisk = readFileSync("supabase/migrations/039_mellowa_v10_beta_capacity.sql", "utf8");
    expect(onDisk.length).toBeGreaterThan(0);
    expect(manifest.migrations).toContain("039");
    expect(manifest.migrations[0]).toBe("001");
  });

  it("never carries authenticated evidence forward from another commit", () => {
    // The v10 authenticated run is real, but it happened at another commit.
    // Carrying it forward is the precise thing this release line is repairing.
    // MW-V11-04 produced a partial run at this baseline, so the rule is no
    // longer "must not pass" — it is "may only pass for the SHA it ran at",
    // which validateReleaseManifest enforces for every suite.
    const auth = manifest.suites.find((s) => s.id === "e2e-authenticated");
    expect(auth).toBeDefined();
    if (isPassing(auth!.status)) {
      expect(auth!.sha).toBe(manifest.rcSha ?? manifest.baselineSha);
      expect(auth!.evidence).toBeTruthy();
    }
  });

  it("keeps skipped authenticated journeys visible in the counts", () => {
    // A partial run is the easiest thing in this whole document to misread as
    // a full one, so the skipped count must be present and non-zero while the
    // fixtures that reach those journeys have not been seeded.
    const auth = manifest.suites.find((s) => s.id === "e2e-authenticated");
    expect(auth?.counts, "authenticated run records no counts").toBeDefined();
    const { passed, skipped, total } = auth!.counts!;
    expect(passed + skipped).toBe(total);
    expect(
      skipped === 0 || auth!.note,
      "skipped authenticated journeys must be explained in the note",
    ).toBeTruthy();
  });

  it("keeps the authenticated blocker open while any required journey is unrun", () => {
    const auth = manifest.suites.find((s) => s.id === "e2e-authenticated");
    const journey = manifest.suites.find((s) => s.id === "e2e-daily-journey");
    const anyUnrun =
      (auth?.counts?.skipped ?? 0) > 0 || !isPassing(journey!.status);
    if (anyUnrun) {
      const open = manifest.blockers.some((b) => b.id === "P1-AUTH-E2E-AT-HEAD");
      expect(open, "authenticated journeys are incomplete but the blocker is closed").toBe(
        true,
      );
    }
  });

  it("claims a performance number only with a raw report behind it", () => {
    // MW-V11-05 measured LCP and CLS for the first time. The rule is no longer
    // "claim nothing" — it is "claim only what was measured, with the artifact".
    const vitals = manifest.suites.find((s) => s.id === "web-vitals");
    expect(vitals).toBeDefined();
    if (isPassing(vitals!.status)) {
      expect(vitals!.evidence, "a performance claim with no report").toBeTruthy();
      expect(() => readFileSync(vitals!.evidence!.split(" ")[0], "utf8")).not.toThrow();
    }
  });

  it("never reports the interaction probe as INP", () => {
    // The probe is click-to-paint on a single control. Calling it INP would be
    // the most tempting misstatement available in this document, because it is
    // the one Core Web Vital still genuinely unmeasured.
    const vitals = manifest.suites.find((s) => s.id === "web-vitals");
    expect(vitals?.note ?? "").toMatch(/INP is NOT measured|INP is not measured/i);

    const report = JSON.parse(
      readFileSync("docs/release/evidence/v11/perf/vitals.json", "utf8"),
    ) as { caveat: string; routes: { lcpMs: number; cls: number }[] };
    expect(report.caveat).toMatch(/INP is not measured/i);
    expect(report.caveat).toMatch(/lab/i);
    // And the raw report must actually contain the numbers being cited.
    expect(report.routes.length).toBeGreaterThan(0);
    for (const route of report.routes) {
      expect(typeof route.lcpMs).toBe("number");
      expect(typeof route.cls).toBe("number");
    }
  });
});

describe("the human launch documents agree with the manifest", () => {
  const manifest = JSON.parse(readFileSync(REAL_MANIFEST_PATH, "utf8")) as ReleaseManifest;
  const doc = readFileSync("docs/launch-go-no-go-v11.md", "utf8");
  const buildState = readFileSync("docs/BUILD_STATE.md", "utf8");

  it("the v11 scorecard names the same baseline commit", () => {
    expect(doc).toContain(manifest.baselineSha);
  });

  it("the v11 scorecard states the same three verdicts", () => {
    expect(doc).toMatch(/Public paid launch:\s*\*{0,2}NO-GO/i);
    expect(manifest.verdicts.public_paid).toBe("NO-GO");
  });

  it("every blocker in the manifest appears in the scorecard, and none is invented", () => {
    for (const blocker of manifest.blockers) {
      expect(doc, `blocker ${blocker.id} missing from the scorecard`).toContain(blocker.id);
    }
    // And the reverse: no scorecard row cites an id the manifest does not have.
    // Closed blockers stay citable, so the document can say what was closed.
    const cited = doc.match(/\bP[012]-[A-Z0-9-]+\b/g) ?? [];
    const known = new Set([
      ...manifest.blockers.map((b) => b.id),
      ...(manifest.closedBlockers ?? []).map((b) => b.id),
    ]);
    for (const id of new Set(cited)) {
      expect(known.has(id), `scorecard cites unknown blocker ${id}`).toBe(true);
    }
  });

  it("the stated number of owner-run blockers matches how many there are", () => {
    // v10 said "four owner-run items" and then listed three. The count is now
    // derived from the manifest and asserted, so the two cannot drift.
    const ownerBlockers = manifest.blockers.filter(
      (b) => b.owner === "Owner" && b.level !== "P2",
    );
    const stated = doc.match(/(\d+)\s+owner-run (?:items|blockers)/i);
    expect(stated, "the scorecard never states an owner-run blocker count").not.toBeNull();
    expect(Number(stated![1])).toBe(ownerBlockers.length);
  });

  it("BUILD_STATE does not call the same suite both green and unrun", () => {
    // The exact v10 contradiction: "RUN AND IS GREEN" alongside "state matrix
    // written but unrun", both about the authenticated matrix.
    const saysGreenAtHead = /authenticated[^.\n]*\b(RUN AND IS GREEN|is green at this baseline)/i.test(
      buildState,
    );
    const saysUnrun = /authenticated[^.\n]*\bunrun\b/i.test(buildState);
    expect(saysGreenAtHead && saysUnrun, "BUILD_STATE contradicts itself").toBe(false);
  });

  it("BUILD_STATE points at the manifest as the active truth", () => {
    expect(buildState).toContain(REAL_MANIFEST_PATH);
  });

  it("the superseded v10 scorecard is labelled as superseded", () => {
    const v10 = readFileSync("docs/launch-go-no-go-v10.md", "utf8");
    expect(v10).toMatch(/SUPERSEDED/i);
    expect(v10).toContain("launch-go-no-go-v11.md");
  });
});
