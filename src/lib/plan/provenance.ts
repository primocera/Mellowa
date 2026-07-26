/**
 * MW-V10-04: plain-language plan provenance.
 *
 * What this is for: a user should be able to tell how the plan in front of them
 * was produced — in particular whether it is a *curated fallback* rather than a
 * generated plan. A fallback is an honest degradation, but only if it is
 * labelled; unlabelled, it is the app quietly serving something generic and
 * letting the user assume it was made for them.
 *
 * What this is deliberately NOT: any exposure of prompt text. The summary names
 * a version identifier, nothing more. The system prompts stay in the code,
 * versioned by src/prompts/versions.ts, and are never sent to the client.
 *
 * Pure module — the summary is a deterministic function of stored fields, so it
 * can be asserted in tests and never drifts from what was actually recorded.
 */

export interface PlanProvenance {
  /** Immutable prompt version id, e.g. "daily-plan-v2@1". */
  promptVersion?: string | null;
  /** Model id as configured at generation time. */
  modelVersion?: string | null;
  /** True when the curated fallback was served instead of a generation. */
  isFallback?: boolean | null;
}

export interface ProvenanceSummary {
  /** One short sentence a non-technical user can read. */
  headline: string;
  /** Version detail, or null when nothing was recorded. Never prompt text. */
  detail: string | null;
  /** True when the user is looking at the curated fallback. */
  fallback: boolean;
}

/** Version-ish identifiers only. Anything longer or prose-like is not shown. */
function safeVersion(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v || v.length > 64) return null;
  return /^[A-Za-z0-9][A-Za-z0-9._@:-]*$/.test(v) ? v : null;
}

export function planProvenanceSummary(p: PlanProvenance): ProvenanceSummary {
  const prompt = safeVersion(p.promptVersion);
  const model = safeVersion(p.modelVersion);

  if (p.isFallback) {
    return {
      // Stated plainly: this is a prepared plan, not one built from the check-in.
      headline:
        "This is Mellowa's prepared backup day — it wasn't generated from your check-in, because generation wasn't available.",
      detail: prompt ? `Backup plan · ${prompt}` : "Backup plan",
      fallback: true,
    };
  }

  if (!prompt && !model) {
    // Older plans predate provenance recording. Say so rather than guess.
    return {
      headline: "This plan was built from your check-in.",
      detail: null,
      fallback: false,
    };
  }

  return {
    headline: "This plan was built from your check-in by Mellowa's planner.",
    detail: [prompt, model].filter(Boolean).join(" · "),
    fallback: false,
  };
}
