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

/**
 * A launch verdict.
 *
 * `UNASSESSED` is not a weaker GO — it is the refusal to make any claim. It is
 * the honest state of a tier whose candidate has been superseded or was never
 * frozen: the gates that would justify GO / CONDITIONAL GO / NO-GO have not been
 * run against the code that would ship, so no verdict can be read yet. Both GO
 * and CONDITIONAL GO are *active* verdicts (a decision to ship, conditionally or
 * not); `NO-GO` and `UNASSESSED` are not.
 */
export type Verdict = "GO" | "NO-GO" | "CONDITIONAL GO" | "UNASSESSED";

/** The active verdicts — a decision to ship, whether or not conditions attach. */
export const ACTIVE_VERDICTS: readonly Verdict[] = ["GO", "CONDITIONAL GO"];
export const isActiveVerdict = (v: Verdict): boolean => ACTIVE_VERDICTS.includes(v);

/**
 * Where a release candidate sits in its life:
 *   draft  — HEAD is moving; nothing is frozen; no verdict can be active.
 *   frozen — a specific SHA is the candidate and gates run against it.
 *   promoted — a frozen candidate whose computed machine record has been
 *              reviewed and adopted as the current release truth (MW-V17-02). A
 *              promoted candidate is still SHA-pinned and immutable; it behaves
 *              like `frozen` for every verdict rule.
 *   superseded — product code changed after the freeze, so the frozen
 *                candidate's evidence no longer certifies HEAD. A superseded
 *                candidate can carry no active verdict until a new one is cut.
 */
export type CandidateLifecycle = "draft" | "frozen" | "promoted" | "superseded";
export const CANDIDATE_LIFECYCLES: readonly CandidateLifecycle[] = [
  "draft",
  "frozen",
  "promoted",
  "superseded",
];

/**
 * The machine-readable record of what changed between the frozen candidate and
 * current product HEAD. Produced by `scripts/classify-rc-drift.mjs`. A
 * `documentation_only` drift is harmless to the candidate; `product_code_changed`
 * supersedes it.
 */
export interface ChangedFileClassification {
  fromRcSha: string;
  toSha: string;
  classification: "documentation_only" | "product_code_changed";
  totals: { changed: number; productCode: number; documentation: number };
  productCodeFiles: string[];
  documentationFiles: string[];
  /** When the classification was produced. */
  generatedAtUtc?: string;
  /** The script that produced it, so it can be regenerated. */
  generatedBy?: string;
  /** Path to the raw artifact. */
  rawEvidence?: string;
  note?: string;
}

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

/**
 * A decision to ship over a blocker that is still open.
 *
 * The point is not to make a blocker go away — it stays in `blockers`, its
 * owner evidence keeps reading `not_run`, and every document generated from
 * this manifest keeps saying so. What an acceptance changes is that shipping
 * over it becomes *attributable*: a named person, a date, the tiers it covers
 * and a rationale long enough to have required thought.
 *
 * That distinction is the whole mechanism. The failure it exists to prevent is
 * a release record quietly edited until it agrees with a decision somebody had
 * already made — at which point the gate stops carrying information. Here the
 * record keeps telling the truth and the signature sits next to it.
 *
 * An acceptance can lift a tier from NO-GO to CONDITIONAL GO. It can never
 * produce a GO: GO means nothing is outstanding, and something is.
 */
export interface AcceptedRisk {
  /** The still-open blocker this accepts. Must exist in `blockers`. */
  blockerId: string;
  /**
   * The human accountable for the decision. A role ("Owner", "Eng") is not a
   * person and is rejected — the point is that a name is attached to it.
   */
  acceptedBy: string;
  /** Date of the decision, ISO 8601 UTC ending in Z. */
  acceptedOnUtc: string;
  /** Which tiers this acceptance covers. Must be tiers the blocker blocks. */
  tiers: ("capped_beta" | "public_paid")[];
  /**
   * Why shipping over this is acceptable, and what the user-visible
   * consequence is if the risk lands. Length-checked: a placeholder cannot
   * satisfy it, which is deliberate — the cost of accepting a risk should be
   * having to articulate it.
   */
  rationale: string;
}

/** Minimum rationale length. Roughly two real sentences. */
export const MIN_RATIONALE_LENGTH = 120;

/**
 * Values that look like a person or an explanation but are not. Checked
 * case-insensitively against the whole trimmed field.
 */
const PLACEHOLDER_RE =
  /^(tbd|todo|n\/?a|none|xxx+|test|owner|eng|engineering|me|myself|team|placeholder|-+|\?+)$/i;

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
  /**
   * Where the candidate sits in its lifecycle. Optional; when absent it is
   * inferred (`frozen` if an rcSha exists, else `draft`), so existing manifests
   * keep working. Set to `superseded` once product code moves past the frozen
   * RC — after which no tier may carry an active verdict until a new candidate
   * is cut.
   */
  candidateLifecycle?: CandidateLifecycle;
  /**
   * Set when the frozen RC has been superseded by later product code. Its
   * presence is a hard signal: every tier must read NO-GO or UNASSESSED. Kept as
   * free text so it can name what changed.
   */
  supersededNote?: string;
  /**
   * Current product-code HEAD, recorded when it has drifted past the frozen RC.
   * Distinct from rcSha precisely so a reader can see the candidate is stale.
   */
  productHeadSha?: string | null;
  /** Classification of the drift between rcSha and productHeadSha. */
  changedSinceRc?: ChangedFileClassification;
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
  /**
   * Decisions to ship over open blockers. Never rewrites the blocker — see
   * {@link AcceptedRisk}.
   */
  acceptedRisks?: AcceptedRisk[];
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
    | "invalid_acceptance"
    | "unfrozen_candidate"
    | "superseded_active_verdict"
    | "candidate_drift"
    | "incomplete_migrations"
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
  opts: { migrationsOnDisk?: readonly string[] } = {},
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

  // ---- candidate lifecycle ----------------------------------------------
  // A superseded candidate is one whose frozen SHA no longer describes the code
  // that would ship. It is signalled either explicitly (candidateLifecycle) or
  // by the presence of a supersededNote — and once superseded, no tier may
  // present an active (GO / CONDITIONAL GO) verdict. That is the exact failure
  // this reconciliation removes: a manifest that says "this candidate is
  // superseded" at the bottom while still reading CONDITIONAL GO at the top.
  const lifecycle: CandidateLifecycle =
    manifest.candidateLifecycle ?? (manifest.rcSha ? "frozen" : "draft");
  if (
    manifest.candidateLifecycle &&
    !CANDIDATE_LIFECYCLES.includes(manifest.candidateLifecycle)
  ) {
    fail("malformed", `unknown candidateLifecycle "${manifest.candidateLifecycle}"`);
  }
  // A "draft" candidate means nothing is frozen — so it cannot also name a
  // frozen rcSha. This is the exact contradictory state the v13 record was in:
  // lifecycle "draft" while carrying a frozen RC and active verdicts. A draft
  // must have rcSha null (which already forbids GO below); once a SHA is frozen
  // the lifecycle is "frozen" or, after HEAD moves, "superseded".
  if (manifest.candidateLifecycle === "draft" && manifest.rcSha !== null) {
    fail(
      "malformed",
      `candidateLifecycle is "draft" but rcSha ${manifest.rcSha.slice(0, 7)} is ` +
        "frozen — a draft candidate has nothing frozen; mark it \"frozen\" or " +
        "\"superseded\"",
    );
  }
  // A frozen or promoted candidate must be SHA-pinned — its whole purpose is to
  // name the exact commit its evidence certifies (MW-V17-02). "promoted" behaves
  // like "frozen" everywhere below; it is a reviewed, adopted frozen record.
  if (
    (manifest.candidateLifecycle === "frozen" ||
      manifest.candidateLifecycle === "promoted") &&
    manifest.rcSha === null
  ) {
    fail(
      "unfrozen_candidate",
      `candidateLifecycle is "${manifest.candidateLifecycle}" but rcSha is null — ` +
        "a frozen/promoted candidate must pin the exact commit it certifies",
    );
  }
  const isSuperseded = lifecycle === "superseded" || !!manifest.supersededNote?.trim();

  if (isSuperseded) {
    // Lifecycle and note must agree — one saying superseded while the other is
    // silent is the drift this is meant to catch.
    if (lifecycle !== "superseded") {
      fail(
        "malformed",
        "a supersededNote is present but candidateLifecycle is not \"superseded\"",
      );
    }
    for (const [tier, verdict] of Object.entries(manifest.verdicts)) {
      if (isActiveVerdict(verdict)) {
        fail(
          "superseded_active_verdict",
          `${tier} presents an active "${verdict}" verdict while the candidate ` +
            "is superseded — no verdict can be read from a superseded candidate " +
            "until a new one is cut; set the tier to NO-GO or UNASSESSED",
        );
      }
    }
  }

  // Drift between the frozen RC and current product HEAD. If HEAD has moved and
  // the change is not documentation-only, the candidate must be marked
  // superseded — otherwise a stale RC keeps carrying a live verdict.
  if (
    manifest.productHeadSha &&
    manifest.rcSha &&
    manifest.productHeadSha !== manifest.rcSha
  ) {
    if (!SHA_RE.test(manifest.productHeadSha)) {
      fail("malformed", `productHeadSha is not a full 40-character SHA: ${manifest.productHeadSha}`);
    }
    const docOnly = manifest.changedSinceRc?.classification === "documentation_only";
    if (!isSuperseded && !docOnly) {
      fail(
        "candidate_drift",
        `productHeadSha ${manifest.productHeadSha.slice(0, 7)} differs from the ` +
          `frozen rcSha ${manifest.rcSha.slice(0, 7)} with product-code changes, ` +
          "but the candidate is not marked superseded — a moved HEAD invalidates " +
          "the RC's evidence unless the drift is documentation-only",
      );
    }
    // If a classification is attached, it must describe this exact range.
    const drift = manifest.changedSinceRc;
    if (drift) {
      if (drift.fromRcSha !== manifest.rcSha) {
        fail(
          "candidate_drift",
          `changedSinceRc.fromRcSha ${drift.fromRcSha.slice(0, 7)} does not match ` +
            `the frozen rcSha ${manifest.rcSha.slice(0, 7)}`,
        );
      }
      if (drift.toSha !== manifest.productHeadSha) {
        fail(
          "candidate_drift",
          `changedSinceRc.toSha ${drift.toSha.slice(0, 7)} does not match ` +
            `productHeadSha ${manifest.productHeadSha.slice(0, 7)}`,
        );
      }
    }
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

  // ---- accepted risks ---------------------------------------------------
  // Validated before they are consulted, so a malformed acceptance can never
  // be the thing that lets a tier ship.
  const blockerById = new Map(manifest.blockers.map((b) => [b.id, b]));
  const closedById = new Map((manifest.closedBlockers ?? []).map((b) => [b.id, b]));
  /** `${blockerId}::${tier}` pairs covered by a well-formed acceptance. */
  const accepted = new Set<string>();

  for (const risk of manifest.acceptedRisks ?? []) {
    const at = `accepted risk for "${risk.blockerId}"`;
    const blocker = blockerById.get(risk.blockerId);

    if (!blocker) {
      fail(
        "invalid_acceptance",
        closedById.has(risk.blockerId)
          ? `${at} names a blocker that is already closed — delete the ` +
              "acceptance rather than carrying it alongside the closure"
          : `${at} names a blocker that does not exist`,
      );
      continue;
    }

    let wellFormed = true;
    const reject = (why: string) => {
      wellFormed = false;
      fail("invalid_acceptance", `${at} ${why}`);
    };

    const by = risk.acceptedBy.trim();
    if (!by) reject("has no accepting person");
    else if (PLACEHOLDER_RE.test(by)) {
      reject(
        `names "${by}", which is a role or a placeholder rather than a person — ` +
          "an acceptance exists to attach a name to the decision",
      );
    }

    if (!UTC_RE.test(risk.acceptedOnUtc)) {
      reject(`has no valid ISO 8601 UTC date: ${risk.acceptedOnUtc}`);
    }

    const rationale = risk.rationale.trim();
    if (PLACEHOLDER_RE.test(rationale)) {
      reject("has a placeholder rationale");
    } else if (rationale.length < MIN_RATIONALE_LENGTH) {
      reject(
        `has a ${rationale.length}-character rationale; at least ` +
          `${MIN_RATIONALE_LENGTH} are required, because the cost of accepting ` +
          "a risk should be having to articulate it",
      );
    }

    if (risk.tiers.length === 0) {
      reject("covers no tiers, so it accepts nothing");
    }
    for (const tier of risk.tiers) {
      if (!blocker.blocks.includes(tier)) {
        reject(`covers ${tier}, which "${blocker.id}" does not block`);
      }
    }

    if (wellFormed) {
      for (const tier of risk.tiers) accepted.add(`${risk.blockerId}::${tier}`);
    }
  }

  for (const blocker of [...openP0, ...openP1]) {
    if (!blocker.owner.trim()) {
      fail("malformed", `blocker "${blocker.id}" has no owner`);
    }
    for (const tier of blocker.blocks) {
      const verdict = manifest.verdicts[tier];

      // GO means nothing is outstanding. Something is — and an acceptance is
      // a decision to ship *knowing* it is outstanding, not a claim that it
      // was resolved. So no acceptance can ever produce a GO.
      if (verdict === "GO") {
        fail(
          "open_p0",
          `blocker "${blocker.id}" (${blocker.level}) is open against ${tier}, ` +
            "which is marked GO" +
            (accepted.has(`${blocker.id}::${tier}`)
              ? " — an accepted risk permits CONDITIONAL GO, never GO"
              : ""),
        );
        continue;
      }

      // Anything short of NO-GO / UNASSESSED over an open blocker needs a
      // signature. This is the rule that makes the mechanism worth having:
      // without it, "CONDITIONAL GO" would be an unsigned way to ship over
      // anything. UNASSESSED is treated like NO-GO here — it makes no claim to
      // ship, so it needs no acceptance.
      if (
        verdict !== "NO-GO" &&
        verdict !== "UNASSESSED" &&
        !accepted.has(`${blocker.id}::${tier}`)
      ) {
        fail(
          "open_p0",
          `blocker "${blocker.id}" (${blocker.level}) is open against ${tier}, ` +
            `which is marked ${verdict} with no accepted risk recorded — ` +
            "either set the tier to NO-GO or record who is accepting it",
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

  // ---- migration completeness -------------------------------------------
  // When the caller supplies the migrations actually on disk, the manifest must
  // enumerate the COMPLETE ordered set — not merely contain one known number.
  // This is the rule that catches "manifest stops at 041 while 042 shipped".
  if (opts.migrationsOnDisk) {
    const disk = [...opts.migrationsOnDisk];
    const declared = manifest.migrations;
    const missing = disk.filter((d) => !declared.includes(d));
    const extra = declared.filter((d) => !disk.includes(d));
    if (missing.length > 0) {
      fail(
        "incomplete_migrations",
        `manifest.migrations is missing on-disk migration(s): ${missing.join(", ")}`,
      );
    }
    if (extra.length > 0) {
      fail(
        "incomplete_migrations",
        `manifest.migrations lists migration(s) not on disk: ${extra.join(", ")}`,
      );
    }
    // Order must match the on-disk order for the migrations they share.
    const declaredInDisk = declared.filter((d) => disk.includes(d));
    if (
      missing.length === 0 &&
      extra.length === 0 &&
      JSON.stringify(declaredInDisk) !== JSON.stringify(disk)
    ) {
      fail(
        "incomplete_migrations",
        "manifest.migrations order does not match the on-disk migration order",
      );
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
    // A rationale is the longest free-text field in the manifest and is written
    // under pressure, at the moment someone wants to ship — exactly when a real
    // inbox or a key gets pasted in as justification.
    ...(manifest.acceptedRisks ?? []).map((r): [string, string | undefined] => [
      `accepted risk for "${r.blockerId}" rationale`,
      r.rationale,
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
  const superseded =
    manifest.candidateLifecycle === "superseded" || !!manifest.supersededNote?.trim();
  const candidate = superseded
    ? `RC ${manifest.rcSha?.slice(0, 7) ?? "?"} SUPERSEDED, HEAD ` +
      `${manifest.productHeadSha?.slice(0, 7) ?? manifest.baselineSha.slice(0, 7)} not frozen`
    : manifest.rcSha
      ? `RC ${manifest.rcSha.slice(0, 7)}`
      : `no frozen candidate (baseline ${manifest.baselineSha.slice(0, 7)})`;
  return (
    `${manifest.release} @ ${candidate} — ` +
    `code gate ${manifest.verdicts.automated_code_gate}, ` +
    `capped beta ${manifest.verdicts.capped_beta}, ` +
    `public paid ${manifest.verdicts.public_paid}`
  );
}
