/**
 * Canonical release manifest and its validator (MW-V11-00).
 *
 * Why this exists: at the end of v10 the repository held three documents that
 * each claimed to be the truth, and they disagreed. `BUILD_STATE.md` said the
 * authenticated state matrix was both "RUN AND IS GREEN" and "unrun";
 * `launch-go-no-go-v10.md` listed `test:e2e:journey` as "not run" one row above
 * a row reporting it green, said "four owner-run items" and then listed three,
 * and closed authenticated E2E in one section while naming it open in another.
 * A reader could pick whichever line suited them.
 *
 * The cure is not more prose. It is one machine-readable manifest that the
 * human documents are checked against, plus a validator that refuses the
 * specific ways a release record goes wrong: a pass claimed at a SHA that is no
 * longer the head, the same suite reported twice with different outcomes, a
 * pass with no raw artifact behind it, counts that cannot add up, a required
 * suite that was skipped, and a GO verdict issued over an open P0.
 *
 * Pure module — no server-only imports, no filesystem access — so the contract
 * test can load it directly and a CLI can run it over any manifest file.
 */

/**
 * Status vocabulary. Exact and load-bearing: every one of these is a different
 * amount of evidence, and collapsing any two of them is how an unrun check ends
 * up reported as green.
 */
export const EVIDENCE_STATUSES = [
  /** The check exists but nobody executed it. Not evidence. */
  "not_run",
  /** Could not be executed — a precondition (env, seed, provider) is missing. */
  "blocked",
  /** Executed but deliberately not exercised. Never counts as a pass. */
  "skipped",
  /** Executed and did not pass. */
  "failed",
  /** Passed on a developer machine. */
  "local_pass",
  /** Passed in CI. */
  "ci_pass",
  /** Passed against a deployed preview on real infrastructure. */
  "preview_pass",
  /** A human executed it against production. */
  "live_rehearsed",
  /** Seen in real production traffic. */
  "observed",
] as const;

export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

/** The statuses that assert something actually passed. */
export const PASSING_STATUSES: readonly EvidenceStatus[] = [
  "local_pass",
  "ci_pass",
  "preview_pass",
  "live_rehearsed",
  "observed",
];

export const isPassing = (status: EvidenceStatus): boolean =>
  PASSING_STATUSES.includes(status);

export type Verdict = "GO" | "NO-GO" | "CONDITIONAL GO";

export interface SuiteCounts {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

export interface SuiteResult {
  /** Stable id, unique within the manifest. */
  id: string;
  /** The exact command a reader can re-run. */
  command: string;
  /** Whether the release verdict depends on this suite. */
  required: boolean;
  status: EvidenceStatus;
  /**
   * The commit the result was produced at. A passing status recorded at a SHA
   * other than the manifest's own is stale by definition: the code moved.
   */
  sha?: string;
  counts?: SuiteCounts;
  /**
   * Where the raw output lives — a path, a run id or a URL. Required for any
   * passing status: a headline number with no artifact behind it is a claim,
   * not evidence.
   */
  evidence?: string;
  note?: string;
}

export interface OwnerEvidence {
  id: string;
  /** What the owner must do, in one line. */
  action: string;
  status: EvidenceStatus;
  /** Filled only once the owner records it. */
  evidence?: string;
  note?: string;
}

export interface Blocker {
  id: string;
  level: "P0" | "P1" | "P2";
  title: string;
  owner: string;
  /** Which launch tier this blocks. */
  blocks: ("capped_beta" | "public_paid")[];
  acceptance: string;
}

/**
 * A blocker that has been closed. Kept rather than deleted so the release
 * record can answer "what closed this, and what proves it" — a blocker that
 * simply vanishes between two revisions is indistinguishable from one that was
 * quietly dropped.
 */
export interface ClosedBlocker extends Blocker {
  /** The slice or action that closed it, e.g. "MW-V11-01". */
  closedBy: string;
  /** Where the proof lives. Required — a closure with no evidence is a claim. */
  evidence: string;
}

export interface ReleaseManifest {
  /** Manifest schema version, so a reader knows how to interpret the fields. */
  schema: 1;
  /** Release line this manifest speaks for, e.g. "v11". */
  release: string;
  /** The commit this truth was established at. */
  baselineSha: string;
  /**
   * The frozen release candidate. Null until the candidate is frozen — a
   * manifest with no RC cannot carry a GO verdict for any tier.
   */
  rcSha: string | null;
  /** UTC instant this manifest was last reconciled, ISO 8601 with Z. */
  reconciledAtUtc: string;
  /** Deploy/build identifier the evidence was produced against, if any. */
  buildId: string | null;
  /** Migration file numbers included in this release, in order. */
  migrations: string[];
  suites: SuiteResult[];
  ownerEvidence: OwnerEvidence[];
  /** Open blockers only. A closed one moves to `closedBlockers`. */
  blockers: Blocker[];
  closedBlockers?: ClosedBlocker[];
  verdicts: {
    automated_code_gate: Verdict;
    capped_beta: Verdict;
    public_paid: Verdict;
  };
  rollback: string;
  /** Documents generated from or validated against this manifest. */
  documents: string[];
}

export interface ManifestViolation {
  /** Machine-readable rule name, so a CI failure says which rule fired. */
  rule:
    | "stale_sha"
    | "contradictory_status"
    | "missing_raw_evidence"
    | "impossible_count"
    | "skipped_required_suite"
    | "open_p0"
    | "unfrozen_candidate"
    | "sensitive_reference"
    | "malformed";
  message: string;
}

/** Anything that would put a person's data or a secret into the release record. */
const SENSITIVE_PATTERNS: { pattern: RegExp; what: string }[] = [
  { pattern: /[\w.+-]+@[\w-]+\.[\w.]+/, what: "an email address" },
  { pattern: /\bsk_(live|test)_[A-Za-z0-9]+/, what: "a Stripe secret key" },
  { pattern: /\bwhsec_[A-Za-z0-9]+/, what: "a Stripe webhook secret" },
  { pattern: /\bey[A-Za-z0-9_-]{20,}\./, what: "a JWT" },
  { pattern: /\bBearer\s+\S+/i, what: "a bearer token" },
  { pattern: /\b(password|api[_-]?key|secret)\s*[:=]\s*\S+/i, what: "a credential" },
];

const SHA_RE = /^[0-9a-f]{40}$/;
const UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * Validate a release manifest.
 *
 * Returns every violation rather than the first, so one run tells the owner
 * everything that has to be repaired. An empty array means the manifest is
 * internally consistent — which is a much weaker claim than "the release is
 * good", and deliberately so: this validator checks that the record is honest,
 * not that the product works.
 */
export function validateReleaseManifest(
  manifest: ReleaseManifest,
): ManifestViolation[] {
  const violations: ManifestViolation[] = [];
  const fail = (rule: ManifestViolation["rule"], message: string) =>
    violations.push({ rule, message });

  // ---- shape ------------------------------------------------------------
  if (manifest.schema !== 1) {
    fail("malformed", `unknown manifest schema ${String(manifest.schema)}`);
  }
  if (!SHA_RE.test(manifest.baselineSha)) {
    fail("malformed", `baselineSha is not a full 40-character SHA: ${manifest.baselineSha}`);
  }
  if (manifest.rcSha !== null && !SHA_RE.test(manifest.rcSha)) {
    fail("malformed", `rcSha is not a full 40-character SHA: ${manifest.rcSha}`);
  }
  if (!UTC_RE.test(manifest.reconciledAtUtc)) {
    fail(
      "malformed",
      `reconciledAtUtc must be ISO 8601 UTC ending in Z: ${manifest.reconciledAtUtc}`,
    );
  }

  // ---- per-suite rules --------------------------------------------------
  const seen = new Map<string, SuiteResult>();
  /** The SHA a passing result must have been produced at. */
  const currentSha = manifest.rcSha ?? manifest.baselineSha;

  for (const suite of manifest.suites) {
    const at = `suite "${suite.id}"`;

    if (!EVIDENCE_STATUSES.includes(suite.status)) {
      fail("malformed", `${at} has unknown status "${suite.status}"`);
      continue;
    }

    // Same suite reported twice with different outcomes — the exact failure
    // mode that let launch-go-no-go-v10 call test:e2e:journey both "not run"
    // and green in adjacent rows.
    const previous = seen.get(suite.id);
    if (previous) {
      fail(
        "contradictory_status",
        previous.status === suite.status
          ? `${at} is listed twice`
          : `${at} is listed twice with different statuses ` +
              `("${previous.status}" and "${suite.status}")`,
      );
    }
    seen.set(suite.id, suite);

    if (isPassing(suite.status)) {
      if (!suite.evidence || suite.evidence.trim() === "") {
        fail(
          "missing_raw_evidence",
          `${at} claims "${suite.status}" with no raw artifact reference`,
        );
      }
      if (!suite.sha) {
        fail("stale_sha", `${at} claims "${suite.status}" without naming the SHA it ran at`);
      } else if (suite.sha !== currentSha) {
        fail(
          "stale_sha",
          `${at} passed at ${suite.sha.slice(0, 7)} but the candidate is ` +
            `${currentSha.slice(0, 7)} — the result must be re-run or re-scoped`,
        );
      }
    }

    if (suite.counts) {
      const { total, passed, failed, skipped } = suite.counts;
      const parts = { total, passed, failed, skipped };
      for (const [key, value] of Object.entries(parts)) {
        if (!Number.isInteger(value) || value < 0) {
          fail("impossible_count", `${at} has a negative or non-integer ${key}: ${value}`);
        }
      }
      if (passed + failed + skipped !== total) {
        fail(
          "impossible_count",
          `${at} counts do not add up: ${passed} + ${failed} + ${skipped} ≠ ${total}`,
        );
      }
      if (isPassing(suite.status) && failed > 0) {
        fail(
          "contradictory_status",
          `${at} claims "${suite.status}" while reporting ${failed} failed`,
        );
      }
      if (isPassing(suite.status) && total > 0 && passed === 0) {
        fail(
          "impossible_count",
          `${at} claims "${suite.status}" but zero of ${total} tests passed`,
        );
      }
      if (suite.status === "failed" && failed === 0) {
        fail("contradictory_status", `${at} is marked failed but reports 0 failures`);
      }
    }

    // A required suite that did not pass keeps the release honest only if the
    // verdicts reflect it; that is checked below, but the skip itself is named
    // here so the owner sees which suite forced the NO-GO.
    if (suite.required && !isPassing(suite.status) && manifest.verdicts.public_paid === "GO") {
      fail(
        "skipped_required_suite",
        `${at} is required and is "${suite.status}", so public paid cannot be GO`,
      );
    }
  }

  // ---- owner evidence ---------------------------------------------------
  for (const item of manifest.ownerEvidence) {
    if (isPassing(item.status) && !item.evidence?.trim()) {
      fail(
        "missing_raw_evidence",
        `owner item "${item.id}" claims "${item.status}" with no recorded evidence`,
      );
    }
  }

  // ---- blockers vs verdicts --------------------------------------------
  const openP0 = manifest.blockers.filter((b) => b.level === "P0");
  const openP1 = manifest.blockers.filter((b) => b.level === "P1");

  for (const blocker of [...openP0, ...openP1]) {
    if (!blocker.owner.trim()) {
      fail("malformed", `blocker "${blocker.id}" has no owner`);
    }
    for (const tier of blocker.blocks) {
      if (manifest.verdicts[tier] === "GO") {
        fail(
          "open_p0",
          `blocker "${blocker.id}" (${blocker.level}) is open against ${tier}, ` +
            "which is marked GO",
        );
      }
    }
  }

  // A blocker cannot be open and closed at the same time, and a closure with
  // nothing behind it is just a deletion with extra steps.
  const openIds = new Set(manifest.blockers.map((b) => b.id));
  for (const closed of manifest.closedBlockers ?? []) {
    if (openIds.has(closed.id)) {
      fail(
        "contradictory_status",
        `blocker "${closed.id}" is listed as both open and closed`,
      );
    }
    if (!closed.closedBy.trim()) {
      fail("malformed", `closed blocker "${closed.id}" does not say what closed it`);
    }
    if (!closed.evidence.trim()) {
      fail(
        "missing_raw_evidence",
        `closed blocker "${closed.id}" records no evidence of the closure`,
      );
    }
  }

  // A verdict of GO has to be about a specific, frozen commit. Without one,
  // "GO" describes a moving target.
  if (manifest.rcSha === null) {
    for (const [tier, verdict] of Object.entries(manifest.verdicts)) {
      if (verdict === "GO" && tier !== "automated_code_gate") {
        fail(
          "unfrozen_candidate",
          `${tier} is GO but no release candidate is frozen (rcSha is null)`,
        );
      }
    }
  }

  // ---- privacy ----------------------------------------------------------
  // Every free-text field a human fills in is a chance to paste a real inbox,
  // a token or a line of someone's plan into the permanent release record.
  const freeText: [string, string | undefined][] = [
    ...manifest.suites.flatMap(
      (s): [string, string | undefined][] => [
        [`suite "${s.id}" evidence`, s.evidence],
        [`suite "${s.id}" note`, s.note],
      ],
    ),
    ...manifest.ownerEvidence.flatMap(
      (o): [string, string | undefined][] => [
        [`owner item "${o.id}" evidence`, o.evidence],
        [`owner item "${o.id}" note`, o.note],
      ],
    ),
    ...manifest.blockers.map((b): [string, string | undefined] => [
      `blocker "${b.id}" acceptance`,
      b.acceptance,
    ]),
    ...(manifest.closedBlockers ?? []).map((b): [string, string | undefined] => [
      `closed blocker "${b.id}" evidence`,
      b.evidence,
    ]),
    ["rollback", manifest.rollback],
  ];

  for (const [where, value] of freeText) {
    if (!value) continue;
    for (const { pattern, what } of SENSITIVE_PATTERNS) {
      if (pattern.test(value)) {
        fail("sensitive_reference", `${where} appears to contain ${what}`);
      }
    }
  }

  return violations;
}

/**
 * The one-line summary a human reads first. Deliberately refuses to say
 * anything reassuring while violations exist.
 */
export function summarizeManifest(manifest: ReleaseManifest): string {
  const violations = validateReleaseManifest(manifest);
  if (violations.length > 0) {
    return `INVALID — ${violations.length} violation(s); no verdict can be trusted.`;
  }
  const candidate = manifest.rcSha
    ? `RC ${manifest.rcSha.slice(0, 7)}`
    : `no frozen candidate (baseline ${manifest.baselineSha.slice(0, 7)})`;
  return (
    `${manifest.release} @ ${candidate} — ` +
    `code gate ${manifest.verdicts.automated_code_gate}, ` +
    `capped beta ${manifest.verdicts.capped_beta}, ` +
    `public paid ${manifest.verdicts.public_paid}`
  );
}
