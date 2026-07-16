// Prompt 15: keep Progress strictly neutral. These helpers describe what the
// user self-reported — counts and ranges only — and never imply cause, health
// status, risk, scores or streaks.

/**
 * Phrases Progress copy must never contain. Causal ("because", "leads to"),
 * clinical ("healthy", "risk"), or pressure ("streak", "score") language.
 * Used by a regression test that scans the rendered Progress source.
 */
export const BANNED_PROGRESS_PHRASES = [
  "because",
  "leads to",
  "feel lighter",
  "feel a little lighter",
  "healthy",
  "unhealthy",
  "risk",
  "score",
  "streak",
  "on track",
  "improving",
  "getting better",
  "you should",
];

export type Metric = { label: string; values: (number | null)[] };

/**
 * A plain-language, non-causal text alternative for a metric chart, including
 * the sample size so a screen reader (or anyone) gets the same information.
 */
export function metricTextSummary(metric: Metric): string {
  const reported = metric.values.filter((v): v is number => v !== null);
  if (reported.length === 0) {
    return `${metric.label}: no check-ins recorded yet.`;
  }
  const min = Math.min(...reported);
  const max = Math.max(...reported);
  const range = min === max ? `${min}` : `${min} to ${max}`;
  return `${metric.label}: self-reported ${range} out of 5, across ${reported.length} check-in${
    reported.length === 1 ? "" : "s"
  }.`;
}
