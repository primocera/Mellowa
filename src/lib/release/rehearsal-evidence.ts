/**
 * MW-09 (v20): owner-live rehearsal EVIDENCE validator.
 *
 * Claude Code never charges live money, sends real email or deletes production
 * accounts — the owner runs each rehearsal and records a sanitized evidence
 * artifact. This pure validator is what closes a release gate: it refuses
 * evidence that is stale (wrong SHA), incomplete (a missing transition, no
 * refund on a billing run), unsafe (any PII / card / token / wellbeing content),
 * or hollow (a zero-test claim). A gate stays open until the artifact passes.
 */

export type RehearsalGate =
  | "billing"
  | "email"
  | "reminder"
  | "outbox"
  | "cron"
  | "deletion";

export type EvidenceEnvironment = "production" | "disposable" | "synthetic";

export interface RehearsalStep {
  id: string;
  observedAt: string; // ISO
  status: "pass" | "fail";
  /** Opaque receipt: Stripe object id / event key / run id. Never PII/content. */
  receipt?: string;
}

export interface RehearsalEvidence {
  gate: RehearsalGate;
  candidateSha: string;
  environment: EvidenceEnvironment;
  startedAt: string; // ISO
  completedAt: string; // ISO
  steps: RehearsalStep[];
  /** Present only for synthetic-transition test evidence. */
  testCounts?: { total: number; passed: number; failed: number };
}

export interface EvidenceValidation {
  ok: boolean;
  violations: string[];
}

/**
 * The required transitions per gate (from the MW-09 rehearsal spec). Missing any
 * of these is a hard failure — the owner cannot close the gate with a partial
 * run.
 */
export const REQUIRED_STEPS: Record<RehearsalGate, readonly string[]> = {
  billing: [
    "price_disclosure",
    "checkout",
    "trial",
    "charge",
    "cancel_at_period_end",
    "reactivation",
    "failure",
    "recovery",
    "late_failure",
    "refund",
  ],
  email: ["sender_verified", "welcome_delivery", "no_sensitive_preview", "category_unsubscribe", "billing_mail_unaffected"],
  reminder: ["consent_version", "chosen_local_time", "never_earlier", "pause_skip_disable", "two_runs_dedupe", "dst_boundary"],
  outbox: ["transient_retry_success", "permanent_dead_letter", "backlog_visible_no_content"],
  cron: ["invoke_all_external_jobs", "durable_run_record", "overlap_no_op"],
  deletion: ["request", "leased_worker_progress", "stripe_cancellation", "data_deletion", "receipt", "retry_after_crash", "no_false_complete"],
};

/** Gates that MUST run against the live production environment. */
const LIVE_GATES: ReadonlySet<RehearsalGate> = new Set<RehearsalGate>([
  "billing",
  "email",
  "reminder",
  "outbox",
  "cron",
  "deletion",
]);

// Sanitization: an evidence artifact is committed to the repo, so it must carry
// opaque identifiers only — never an address, message body, card data, token or
// wellbeing content.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const CARD_RE = /\b(?:\d[ -]?){13,19}\b/;
const TOKEN_RE = /\b(?:Bearer\s+\S+|sk_live_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|eyJ[A-Za-z0-9_-]{10,})/;

function isIso(s: unknown): s is string {
  return typeof s === "string" && Number.isFinite(Date.parse(s));
}

function scanForbiddenContent(ev: RehearsalEvidence): string[] {
  const out: string[] = [];
  const strings: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(ev);
  for (const s of strings) {
    if (EMAIL_RE.test(s)) out.push("evidence contains an email address");
    if (CARD_RE.test(s)) out.push("evidence contains a card-like number");
    if (TOKEN_RE.test(s)) out.push("evidence contains a secret/token");
  }
  return [...new Set(out)];
}

export function validateRehearsalEvidence(
  ev: RehearsalEvidence,
  opts: { expectedSha: string }
): EvidenceValidation {
  const v: string[] = [];

  // 1. SHA freshness — evidence from another candidate never carries forward.
  if (!ev.candidateSha) v.push("missing candidateSha");
  else if (ev.candidateSha !== opts.expectedSha) {
    v.push(`stale evidence: candidateSha ${ev.candidateSha.slice(0, 7)} != expected ${opts.expectedSha.slice(0, 7)}`);
  }

  // 2. Environment class.
  if (LIVE_GATES.has(ev.gate) && ev.testCounts === undefined && ev.environment !== "production") {
    v.push(`gate ${ev.gate} must be observed in production, not ${ev.environment}`);
  }

  // 3. Timestamps present and ordered.
  if (!isIso(ev.startedAt) || !isIso(ev.completedAt)) {
    v.push("missing/invalid startedAt or completedAt");
  } else if (Date.parse(ev.completedAt) < Date.parse(ev.startedAt)) {
    v.push("completedAt precedes startedAt");
  }

  // 4. Every required step present, in-window, and passing.
  const required = REQUIRED_STEPS[ev.gate] ?? [];
  const byId = new Map(ev.steps.map((s) => [s.id, s]));
  for (const id of required) {
    const step = byId.get(id);
    if (!step) {
      v.push(`missing required step "${id}"`);
      continue;
    }
    if (step.status !== "pass") v.push(`step "${id}" did not pass`);
    if (!isIso(step.observedAt)) v.push(`step "${id}" missing observedAt`);
    else if (
      isIso(ev.startedAt) &&
      isIso(ev.completedAt) &&
      (Date.parse(step.observedAt) < Date.parse(ev.startedAt) ||
        Date.parse(step.observedAt) > Date.parse(ev.completedAt))
    ) {
      v.push(`step "${id}" observed outside the run window`);
    }
  }

  // 5. Billing must include a refund (cleanup on every run).
  if (ev.gate === "billing" && !byId.has("refund")) {
    v.push("billing evidence has no refund step");
  }

  // 6. Zero-test / failing synthetic evidence is not proof.
  if (ev.testCounts) {
    if (ev.testCounts.total <= 0) v.push("testCounts claims zero discovered tests");
    if (ev.testCounts.failed > 0) v.push("testCounts reports failures");
  }

  // 7. No forbidden content anywhere.
  v.push(...scanForbiddenContent(ev));

  return { ok: v.length === 0, violations: v };
}
