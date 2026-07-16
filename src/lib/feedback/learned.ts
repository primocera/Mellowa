// Prompt 14: turn plan feedback into a transparent, removable "Mellowa
// learned" list and into bounded, injection-safe generation hints.
//
// Safety design:
//  - Only a fixed allow-list of verdicts ever influences generation. Free-text
//    notes are stored for the user but NEVER injected into a prompt, so a note
//    can't smuggle instructions to the model.
//  - Hints are canonical phrases chosen from this file, never user text.
//  - We describe observed choices only — no medical, psychological or
//    adherence ("you skipped 3 days") inference.

export type Verdict =
  | "helpful"
  | "not_for_me"
  | "too_much"
  | "too_little_time"
  | "didnt_fit_food";

export const FEEDBACK_OPTIONS: { verdict: Verdict; label: string }[] = [
  { verdict: "helpful", label: "Helpful" },
  { verdict: "not_for_me", label: "Not for me" },
  { verdict: "too_much", label: "Too much" },
  { verdict: "too_little_time", label: "Too little time" },
  { verdict: "didnt_fit_food", label: "Didn't fit food preferences" },
];

export function isVerdict(v: string): v is Verdict {
  return FEEDBACK_OPTIONS.some((o) => o.verdict === v);
}

export type FeedbackRow = { item_key: string; verdict: string };

export type Learned = {
  /** Stable signal id — also the removal handle. */
  signal: Verdict;
  /** Sentence shown to the user, plain and non-judgmental. */
  label: string;
  /** Canonical instruction fragment for the generator (no user text). */
  hint: string;
};

// A signal only appears once it's been seen at least this many times, so a
// single tap doesn't reshape everything.
const MIN_COUNT = 2;
// Cap how much we ever feed the generator.
const MAX_HINTS = 4;

const SIGNALS: Record<
  Exclude<Verdict, "helpful">,
  { label: string; hint: string }
> = {
  not_for_me: {
    label: "Some recent plans weren't quite right for you.",
    hint: "Recent plans didn't fully land — vary the approach and keep it simple.",
  },
  too_much: {
    label: "You've told us some days felt like too much.",
    hint: "Keep the plan light: fewer tasks and one small reset.",
  },
  too_little_time: {
    label: "You often have little time.",
    hint: "Favour quick, low-effort options that fit a busy day.",
  },
  didnt_fit_food: {
    label: "Some meals didn't fit your food preferences.",
    hint: "Lean harder on the user's stated food preferences and dislikes.",
  },
};

/**
 * Build the user-facing learned list from recent feedback rows. Bounded and
 * ordered by how strongly each signal appears.
 */
export function deriveLearned(rows: FeedbackRow[]): Learned[] {
  const counts = new Map<Verdict, number>();
  for (const r of rows) {
    if (isVerdict(r.verdict) && r.verdict !== "helpful") {
      counts.set(r.verdict, (counts.get(r.verdict) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= MIN_COUNT)
    .sort((a, b) => b[1] - a[1])
    .map(([signal]) => ({
      signal,
      label: SIGNALS[signal as Exclude<Verdict, "helpful">].label,
      hint: SIGNALS[signal as Exclude<Verdict, "helpful">].hint,
    }));
}

/** Canonical, bounded hint block for the generator, or "" when nothing sticks. */
export function learnedToPromptHints(learned: Learned[]): string {
  if (learned.length === 0) return "";
  const hints = learned.slice(0, MAX_HINTS).map((l) => `- ${l.hint}`);
  return `WHAT THE USER PREFERS (from their own feedback):\n${hints.join("\n")}`;
}
