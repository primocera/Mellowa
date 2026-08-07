import {
  validateReleaseManifest,
  isPassing,
  type ReleaseManifest,
  type EvidenceStatus,
} from "@/lib/release/manifest";

/**
 * Non-compensating readiness rubric (XAPP-95-02).
 *
 * A high product-quality score is NOT beta or public-paid readiness. Automated
 * tests prove contracts; they do not prove a real charge, an authenticated
 * browser journey, a renewal, or repeated customer value. This engine scores the
 * three tiers SEPARATELY and refuses to average a failed gate away:
 *
 *  - An open P0 (safety / privacy / data / billing / cross-app) caps the tier it
 *    blocks **below 8**, regardless of how many other points exist.
 *  - A required owner gate that is not_run/blocked caps **public-paid below 9**.
 *  - 9.5 is reachable only when every non-compensating gate passes AND the mature
 *    customer-value hypotheses pass — never from documentation volume, test count
 *    or a more precisely described owner-gated step.
 *
 * Pure module: it reads the machine manifest and explicit owner observations
 * (defaulting to the honest "not observed" state) and returns a reproducible
 * score + caps + blockers per tier. It never invents evidence: absent evidence
 * scores the observed state, not the intended one.
 */

export type Tier = "product" | "capped_beta" | "public_paid";

/** Maturity of the predeclared customer-value hypotheses for a tier. */
export type ValueEvidence = "pass" | "fail" | "immature" | "absent";

export interface ReadinessInputs {
  manifest: ReleaseManifest;
  migrationsOnDisk?: readonly string[];
  /** Authenticated E2E matrix at the candidate (P1-AUTH-E2E-AT-HEAD). */
  authE2eAtCandidate?: EvidenceStatus;
  /** Live charge→cancel→reactivate→recover→refund (P0-LIVE-TRANSACTION). */
  liveTransaction?: EvidenceStatus;
  /** Mature, predeclared customer-value evidence (D2/D3, renewal, …). */
  matureValue?: ValueEvidence;
}

export interface TierReadiness {
  tier: Tier;
  /** 0–10, one decimal. Always below any active cap. */
  score: number;
  /** True when a non-compensating rule limited the score. */
  capped: boolean;
  /** Human-readable caps that fired, most severe first. */
  caps: string[];
  /** Blockers relevant to this tier. */
  blockers: string[];
  /** The single shortest next action. */
  nextAction: string;
}

export interface ReadinessReport {
  generatedFor: string;
  manifestValid: boolean;
  product: TierReadiness;
  cappedBeta: TierReadiness;
  publicPaid: TierReadiness;
}

const P0_CAP = 7.9; // strictly below 8
const OWNER_GATE_CAP = 8.9; // strictly below 9
const NO_CANDIDATE_CAP = 8.9;
const INVALID_CAP = 5.0;
const TARGET = 9.5;

/** Score one tier: start from a ceiling, then apply every cap that fires. */
function scoreTier(
  tier: Tier,
  base: number,
  caps: { value: number; reason: string }[],
  blockers: string[],
  nextAction: string
): TierReadiness {
  let score = base;
  const applied: string[] = [];
  // Apply strongest (lowest) caps first for a stable, most-severe-first list.
  for (const c of [...caps].sort((a, b) => a.value - b.value)) {
    if (c.value < score) {
      score = c.value;
      applied.push(c.reason);
    }
  }
  return {
    tier,
    score: Math.round(score * 10) / 10,
    capped: applied.length > 0,
    caps: applied,
    blockers,
    nextAction,
  };
}

export function scoreReadiness(inputs: ReadinessInputs): ReadinessReport {
  const { manifest } = inputs;
  const violations = validateReleaseManifest(manifest, {
    migrationsOnDisk: inputs.migrationsOnDisk,
  });
  const manifestValid = violations.length === 0;
  const authE2e = inputs.authE2eAtCandidate ?? "not_run";
  const live = inputs.liveTransaction ?? "not_run";
  const value = inputs.matureValue ?? "absent";

  const frozen = manifest.rcSha !== null && manifest.candidateLifecycle !== "draft";
  const superseded =
    manifest.candidateLifecycle === "superseded" || Boolean(manifest.supersededNote?.trim());

  const openP0 = manifest.blockers.filter((b) => b.level === "P0");
  const openP1 = manifest.blockers.filter((b) => b.level === "P1");

  const acceptedFor = (blockerId: string, tier: "capped_beta" | "public_paid") =>
    (manifest.acceptedRisks ?? []).some(
      (r) => r.blockerId === blockerId && r.tiers.includes(tier)
    );

  const requiredSuitesGreen = manifest.suites
    .filter((s) => s.required)
    .every((s) => isPassing(s.status));

  // Shared caps that apply to any release-bearing tier.
  const invalidCap = manifestValid
    ? []
    : [{ value: INVALID_CAP, reason: `release record invalid (${violations.length} violation(s)); no score can be trusted` }];
  const supersededCap = superseded
    ? [{ value: NO_CANDIDATE_CAP, reason: "candidate superseded — cut a new one before a tier can be read" }]
    : [];

  // ---- Product capability -------------------------------------------------
  // Not gated by owner/live items: an owner-run live/environment gate (owner
  // "Owner") is not a product-capability defect. Only an ENGINEERING P0 (a code /
  // safety / privacy / data / billing / cross-app defect) caps product below 8.
  const productDefectP0 = openP0.filter((b) => b.owner.trim() !== "Owner");
  const productCaps = [
    ...invalidCap,
    ...productDefectP0.map((b) => ({
      value: P0_CAP,
      reason: `open ${b.id} (P0 defect) — caps product capability below 8`,
    })),
  ];
  const product = scoreTier(
    "product",
    requiredSuitesGreen && manifestValid ? 9.0 : manifestValid ? 8.5 : INVALID_CAP,
    productCaps,
    productDefectP0.map((b) => b.id),
    requiredSuitesGreen
      ? "Product contracts are green; readiness is gated by owner/value evidence, not code."
      : "Freeze a candidate and record the automated gates as passing at that SHA."
  );

  // ---- Capped beta --------------------------------------------------------
  const betaBlockers: string[] = [];
  const betaCaps = [...invalidCap, ...supersededCap];
  if (!frozen)
    betaCaps.push({ value: NO_CANDIDATE_CAP, reason: "no frozen candidate — a tier verdict needs a specific SHA" });
  for (const b of openP0) {
    if (b.blocks.includes("capped_beta")) {
      betaCaps.push({ value: P0_CAP, reason: `open ${b.id} (P0) blocks capped beta` });
      betaBlockers.push(b.id);
    }
  }
  for (const b of openP1) {
    if (b.blocks.includes("capped_beta") && !acceptedFor(b.id, "capped_beta")) {
      betaCaps.push({ value: OWNER_GATE_CAP, reason: `open ${b.id} (P1) blocks capped beta with no accepted risk` });
      betaBlockers.push(b.id);
    }
  }
  // 9.5 for beta additionally requires authenticated core journeys observed.
  if (!isPassing(authE2e))
    betaCaps.push({ value: TARGET - 0.1, reason: "authenticated core journeys not observed at the candidate" });
  const cappedBeta = scoreTier(
    "capped_beta",
    frozen && requiredSuitesGreen ? 9.6 : 9.0,
    betaCaps,
    betaBlockers,
    !frozen
      ? "Freeze the v16 candidate."
      : betaBlockers.length
        ? "Accept or close the blockers above, or keep the cohort bounded under an explicit accepted risk."
        : "Observe the authenticated core journeys at the candidate."
  );

  // ---- Public paid --------------------------------------------------------
  const paidBlockers: string[] = [];
  const paidCaps = [...invalidCap, ...supersededCap];
  if (!frozen)
    paidCaps.push({ value: NO_CANDIDATE_CAP, reason: "no frozen candidate" });
  for (const b of openP0) {
    if (b.blocks.includes("public_paid")) {
      paidCaps.push({ value: P0_CAP, reason: `open ${b.id} (P0) blocks public paid` });
      paidBlockers.push(b.id);
    }
  }
  for (const b of openP1) {
    if (b.blocks.includes("public_paid") && !acceptedFor(b.id, "public_paid")) {
      paidCaps.push({ value: OWNER_GATE_CAP, reason: `open ${b.id} (P1) blocks public paid with no accepted risk` });
      paidBlockers.push(b.id);
    }
  }
  // Required owner gates: not_run/blocked caps public paid below 9.
  if (!isPassing(authE2e))
    paidCaps.push({ value: OWNER_GATE_CAP, reason: "authenticated E2E at candidate is not observed (owner gate) — caps public paid below 9" });
  if (!isPassing(live))
    paidCaps.push({ value: OWNER_GATE_CAP, reason: "live-money rehearsal is not recorded (owner gate) — caps public paid below 9" });
  // Mature value is a hard requirement for 9.5.
  if (value !== "pass")
    paidCaps.push({
      value: TARGET - 0.1,
      reason:
        value === "fail"
          ? "mature value hypotheses failed"
          : value === "immature"
            ? "value cohort not yet mature (pending, not a pass)"
            : "no mature customer-value evidence yet",
    });
  const publicPaid = scoreTier(
    "public_paid",
    frozen && requiredSuitesGreen ? 9.6 : 9.0,
    paidCaps,
    paidBlockers,
    !isPassing(live) || !isPassing(authE2e)
      ? "Run the owner gates (authenticated E2E matrix + live-money rehearsal) at the frozen candidate."
      : value !== "pass"
        ? "Collect one complete mature value window against the predeclared hypotheses."
        : "All gates pass; re-score."
  );

  return {
    generatedFor: manifest.release,
    manifestValid,
    product,
    cappedBeta,
    publicPaid,
  };
}
