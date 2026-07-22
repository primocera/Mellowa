/**
 * Go/no-go template gate (MW-V9-00).
 *
 * A release go/no-go scorecard must never be able to declare a GO verdict for
 * public paid launch while required evidence fields are still blank. This pure
 * validator parses a scorecard's markdown and, when the paid verdict is GO,
 * requires that the release-candidate SHA, automated command results, live
 * evidence and the sign-off are actually filled in — not left as placeholders.
 *
 * Pure module: no server-only imports, so the contract test can load it
 * directly and CI can run it on any go/no-go document.
 */

/** A blank placeholder pattern that must not survive a GO verdict. */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /_{4,}/, // ____ blank line fills (RC commit, signature, date)
  /Evidence:\s*_+\s*$/im, // "Evidence: __"
  /RC commit\s*=\s*_+/i, // "RC commit = ____"
  /RC SHA\s*=\s*_+/i,
  /Signed:\s*_+/i,
];

export type PaidVerdict = "GO" | "NO-GO" | "CONDITIONAL GO" | "UNKNOWN";

export interface GateResult {
  verdict: PaidVerdict;
  /** Reasons the document fails the gate (empty ⇒ passes). */
  violations: string[];
}

/**
 * Extract the declared public-paid-launch verdict. Recognises the canonical
 * "Public paid launch: NO-GO / CONDITIONAL GO / GO" line used across the
 * v6/v7/v8/v9 scorecards.
 */
export function extractPaidVerdict(markdown: string): PaidVerdict {
  const line = markdown.match(/Public paid launch:\s*\**\s*(NO-GO|CONDITIONAL GO|GO)/i);
  if (!line) return "UNKNOWN";
  const raw = line[1].toUpperCase();
  if (raw === "NO-GO") return "NO-GO";
  if (raw === "CONDITIONAL GO") return "CONDITIONAL GO";
  if (raw === "GO") return "GO";
  return "UNKNOWN";
}

/**
 * Validate a go/no-go scorecard. Only a GO verdict is gated: a document may
 * honestly stay NO-GO or CONDITIONAL GO with open evidence, but it may not
 * claim public paid GO while any required field is still a blank placeholder.
 */
export function evaluateGoNoGo(markdown: string): GateResult {
  const verdict = extractPaidVerdict(markdown);
  const violations: string[] = [];

  if (verdict === "GO") {
    for (const pattern of PLACEHOLDER_PATTERNS) {
      if (pattern.test(markdown)) {
        violations.push(
          `GO verdict but blank placeholder still present (matched ${pattern}). ` +
            "Fill RC SHA, evidence and signature before selecting GO.",
        );
      }
    }
    // Required evidence anchors that a real GO must contain.
    for (const anchor of [
      /RC (commit|SHA)\s*[=:]/i,
      /Signed:/i,
    ]) {
      if (!anchor.test(markdown)) {
        violations.push(`GO verdict but required section missing (${anchor}).`);
      }
    }
  }

  return { verdict, violations };
}
