import {
  isVerdict,
  type FeedbackRow,
  type SignalSuppression,
  type Verdict,
} from "@/lib/feedback/learned";

/**
 * MW-V18-12: one versioned, transparent preference model.
 *
 * The learned system (feedback/learned.ts) already derives a bounded, removable
 * list from a CLOSED verdict set and never injects free text. This wraps it in
 * the explicit model the pack asks for: every preference carries its category,
 * source, confidence, first/last-seen, an EXPIRY (unused inferred preferences
 * decay), and a plain "Mellowa used this because…" explanation.
 *
 * Hard rules preserved:
 * - Source is always "inferred" here (derived from the user's own feedback);
 *   nothing is a hidden hard rule. Inferred preferences are suggestions.
 * - No medical/psychological/adherence inference — only the closed verdict set.
 * - The value is a canonical slug, never user free text, so analytics and this
 *   model can carry category/value without ever carrying content.
 *
 * Pure module (injected clock) — fully fixture-testable.
 */

export const PREFERENCE_MODEL_VERSION = "m12.1";

/** Inferred preferences decay if not reinforced within this window. */
export const PREFERENCE_DECAY_DAYS = 60;

/** A signal needs this many observations before it becomes a preference. */
const MIN_COUNT = 2;

export type PreferenceSource = "inferred" | "explicit";

export interface LearnedPreference {
  /** Stable id + removal handle (the verdict signal). */
  signal: Verdict;
  category: "plan_load" | "food_fit" | "time" | "general_fit";
  /** Canonical value slug (never free text). */
  value: string;
  source: PreferenceSource;
  /** 0–1, from how consistently the signal appears (capped). */
  confidence: number;
  count: number;
  firstSeen: string;
  lastSeen: string;
  /** When an unused inferred preference expires (lastSeen + decay window). */
  expiresAt: string;
  /** Plain-language "Mellowa used this because…". */
  whyUsed: string;
}

const CATEGORY: Record<Exclude<Verdict, "helpful">, LearnedPreference["category"]> = {
  not_for_me: "general_fit",
  too_much: "plan_load",
  too_little_time: "time",
  didnt_fit_food: "food_fit",
};

const WHY: Record<Exclude<Verdict, "helpful">, string> = {
  not_for_me: "you told us recent plans didn't quite fit, so we vary the approach.",
  too_much: "you told us some days felt like too much, so we keep the plan lighter.",
  too_little_time: "you often told us time was short, so we favour quick options.",
  didnt_fit_food: "you told us some meals didn't fit, so we lean on your food preferences.",
};

interface Agg {
  count: number;
  first: number;
  last: number;
}

/**
 * Build the versioned preference model from feedback + suppression boundaries,
 * dropping inferred preferences whose newest supporting feedback has decayed
 * (older than PREFERENCE_DECAY_DAYS) — so an unused preference expires instead of
 * lingering forever.
 */
export function buildPreferences(
  rows: FeedbackRow[],
  suppressions: SignalSuppression[] = [],
  now: Date = new Date()
): LearnedPreference[] {
  const boundary = new Map<string, number>();
  for (const s of suppressions) {
    const t = Date.parse(s.suppressed_at);
    if (Number.isFinite(t)) boundary.set(s.signal, t);
  }

  const agg = new Map<Verdict, Agg>();
  for (const r of rows) {
    if (!isVerdict(r.verdict) || r.verdict === "helpful") continue;
    const at = r.created_at ? Date.parse(r.created_at) : NaN;
    const cut = boundary.get(r.verdict);
    if (cut !== undefined) {
      // Feedback at/before the removal boundary no longer counts (free Undo).
      if (!Number.isFinite(at) || at <= cut) continue;
    }
    const when = Number.isFinite(at) ? at : now.getTime();
    const cur = agg.get(r.verdict) ?? { count: 0, first: when, last: when };
    cur.count += 1;
    cur.first = Math.min(cur.first, when);
    cur.last = Math.max(cur.last, when);
    agg.set(r.verdict, cur);
  }

  const decayMs = PREFERENCE_DECAY_DAYS * 86_400_000;
  const out: LearnedPreference[] = [];
  for (const [signal, a] of agg) {
    if (a.count < MIN_COUNT) continue;
    if (signal === "helpful") continue;
    // Decay: expired if the newest supporting feedback is older than the window.
    if (now.getTime() - a.last > decayMs) continue;
    const key = signal as Exclude<Verdict, "helpful">;
    out.push({
      signal,
      category: CATEGORY[key],
      value: signal,
      source: "inferred",
      confidence: Math.min(1, Math.round((a.count / (MIN_COUNT * 2)) * 100) / 100),
      count: a.count,
      firstSeen: new Date(a.first).toISOString(),
      lastSeen: new Date(a.last).toISOString(),
      expiresAt: new Date(a.last + decayMs).toISOString(),
      whyUsed: WHY[key],
    });
  }
  return out.sort((x, y) => y.confidence - x.confidence || y.count - x.count);
}

/**
 * Conflict resolution: a fresh, explicit check-in signal for TODAY overrides a
 * contradicting learned preference for today's plan. e.g. the user historically
 * said "too much" (→ lighter), but today's check-in reports high energy — today
 * wins, so we do not force a lighter plan against the current signal. Returns the
 * preferences that still apply after removing today-contradicted ones.
 */
export function applyCurrentContext(
  preferences: LearnedPreference[],
  todayContradicts: Verdict[]
): LearnedPreference[] {
  const contra = new Set(todayContradicts);
  return preferences.filter((p) => !contra.has(p.signal));
}
