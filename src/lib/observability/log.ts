/**
 * MW-V18-X02: one structured, redacting logger for the whole app.
 *
 * Every critical path can emit a single-line JSON record with a trace id, the
 * route/job, a result code, a latency bucket and safe provider/model metadata —
 * and NOTHING ELSE. Emails, tokens, Stripe payloads, wellbeing free text and raw
 * user content are hard-redacted before anything is written, so logs are
 * diagnosable without exposing a person.
 *
 * The logger NEVER throws: an observability failure must not break a user
 * action (the X02 acceptance). All emission is wrapped.
 *
 * Pure enough to unit-test: `redactValue`/`redactObject` are exported and the
 * emitter takes an injectable sink.
 */

export type LogResult = "ok" | "error" | "timeout" | "denied" | "invalid" | "degraded";
export type LatencyBucket = "lt50" | "lt200" | "lt500" | "lt1s" | "lt5s" | "gte5s";

export function latencyBucket(ms: number): LatencyBucket {
  if (!Number.isFinite(ms) || ms < 0) return "gte5s";
  if (ms < 50) return "lt50";
  if (ms < 200) return "lt200";
  if (ms < 500) return "lt500";
  if (ms < 1000) return "lt1s";
  if (ms < 5000) return "lt5s";
  return "gte5s";
}

export interface LogRecord {
  /** Route or job name, e.g. "api/ai/daily-plan" or "job/account-deletion". */
  route: string;
  result: LogResult;
  /** Opaque account id (uuid) only — never an email. */
  accountRef?: string | null;
  latencyMs?: number;
  provider?: string;
  modelVersion?: string;
  promptVersion?: string;
  /** Coarse machine-readable reason, e.g. "rls_denied", "provider_timeout". */
  code?: string;
  /** A trace id to correlate a user's error receipt with the server log. */
  traceId?: string;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const TOKEN_RE = /\b(sk|pk|rk|whsec|Bearer|eyJ)[A-Za-z0-9._-]{6,}/g;
const LONG_HEX_RE = /\b[a-f0-9]{32,}\b/gi;

/** Redact a single value: strip emails/tokens/long secrets, bound length. */
export function redactValue(v: unknown): unknown {
  if (typeof v !== "string") {
    if (typeof v === "number" || typeof v === "boolean" || v === null) return v;
    return "[redacted:object]"; // never log nested free-form objects verbatim
  }
  const cleaned = v
    .replace(EMAIL_RE, "[email]")
    .replace(TOKEN_RE, "[token]")
    .replace(LONG_HEX_RE, "[hex]");
  // Bound length so a stray body/prose value cannot flood or leak.
  return cleaned.length > 200 ? `${cleaned.slice(0, 200)}…` : cleaned;
}

/** Keys that must never be logged at all, whatever their value. */
const FORBIDDEN_KEYS = new Set([
  "email", "to_email", "password", "token", "access_token", "refresh_token",
  "authorization", "html", "body", "subject", "notes", "note", "journal",
  "mood", "stress", "content", "message", "prompt", "secret", "api_key",
]);

/** Redact an object shallowly, dropping forbidden keys and cleaning values. */
export function redactObject(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(input)) {
    if (FORBIDDEN_KEYS.has(k.toLowerCase())) {
      out[k] = "[redacted]";
      continue;
    }
    out[k] = redactValue(val);
  }
  return out;
}

export type LogSink = (line: string) => void;

const defaultSink: LogSink = (line) => {
  // Single-line JSON to stdout; the platform ships it. Wrapped by the caller.
  console.log(line);
};

/**
 * Emit one structured, redacted log line. Returns the traceId used so a caller
 * can hand it to a user-facing diagnostic receipt. Never throws.
 */
export function logEvent(record: LogRecord, sink: LogSink = defaultSink): string {
  const traceId = record.traceId ?? newTraceId();
  try {
    const safe = redactObject({
      ts: new Date().toISOString(),
      route: record.route,
      result: record.result,
      code: record.code ?? null,
      account_ref: record.accountRef ?? null,
      latency_bucket: record.latencyMs === undefined ? null : latencyBucket(record.latencyMs),
      provider: record.provider ?? null,
      model_version: record.modelVersion ?? null,
      prompt_version: record.promptVersion ?? null,
      trace_id: traceId,
    });
    sink(JSON.stringify(safe));
  } catch {
    // Observability must never break the product.
  }
  return traceId;
}

/**
 * A privacy-safe diagnostic receipt to surface to a user on an error. It carries
 * only the opaque trace id and a timestamp — no error detail, no PII — so a user
 * can quote it to support and an operator can correlate it to the server log.
 */
export function diagnosticReceipt(traceId: string): { reference: string; at: string } {
  return { reference: traceId, at: new Date().toISOString() };
}

/** Opaque, PII-free correlation id. */
export function newTraceId(): string {
  const rnd =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `t_${rnd.replace(/-/g, "").slice(0, 24)}`;
}
