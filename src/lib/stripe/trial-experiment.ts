/**
 * MW-V10-02: server-owned trial-length experiment.
 *
 * Why this exists: Premium is packaged around adapting today, reusing what
 * works and carrying decisions into next week. A 3-day trial can end before a
 * user ever reaches a week closeout, so whether 7 days converts better is a
 * question only observed retention can answer — not a preference. This module
 * is the single place that decides how many trial days a user gets.
 *
 * Rules encoded here:
 * - The variant allowlist is closed. An unknown code never becomes a trial
 *   length; it falls back to control.
 * - Assignment is server-side and deterministic from the user id, so the same
 *   user always resolves to the same arm before anything is written.
 * - A PINNED assignment always wins. Once a trial exists with `trial_days`
 *   stored, that number is authoritative for every disclosure — flipping the
 *   flag off, changing the rollout percentage or removing a variant from the
 *   allowlist can never move an existing user's charge date.
 * - Default production behaviour is unchanged: with no env set the experiment
 *   is off and everyone resolves to the 3-day control.
 *
 * Pure module (no `server-only`, no node crypto) so the checkout route, server
 * components, copy helpers and contract tests all read the same truth.
 */

/** Closed allowlist: variant code → trial length in days. */
export const TRIAL_VARIANTS = {
  /** Current production behaviour. */
  control: 3,
  /** Optional beta arm: long enough to reach one real Week closeout. */
  week_beta: 7,
} as const;

export type TrialVariant = keyof typeof TRIAL_VARIANTS;

export const CONTROL_VARIANT: TrialVariant = "control";
export const CONTROL_TRIAL_DAYS = TRIAL_VARIANTS.control;

/** Trial lengths the app will ever write or disclose. */
export const MIN_TRIAL_DAYS = 1;
export const MAX_TRIAL_DAYS = 31;

export function isTrialVariant(value: unknown): value is TrialVariant {
  // Object.hasOwn, not `in`: `in` walks the prototype chain, so "toString" and
  // "constructor" would pass and then resolve to a non-number "trial length".
  return typeof value === "string" && Object.hasOwn(TRIAL_VARIANTS, value);
}

export function trialDaysForVariant(variant: TrialVariant): number {
  return TRIAL_VARIANTS[variant];
}

// --- Owner-controlled settings -----------------------------------------------

export interface TrialExperimentSettings {
  /** True only when a cohort is actually being assigned a non-control arm. */
  active: boolean;
  /** The arm being tested against control. */
  variant: TrialVariant;
  /** Percentage of new trials assigned to `variant` (0–100). */
  percent: number;
  salt: string;
}

type EnvLike = Record<string, string | undefined>;

const DEFAULT_SALT = "mellowa-trial-length-v10";

function isTruthy(raw: string | undefined): boolean {
  return raw === "1" || raw?.toLowerCase() === "true";
}

/**
 * Read the experiment configuration. Opt-in and fails closed to control: a
 * missing flag, an unknown variant code, a non-numeric or out-of-range
 * percentage, or a percentage of 0 all mean "no experiment is running".
 */
export function trialExperimentSettings(
  env: EnvLike = process.env
): TrialExperimentSettings {
  const enabled = isTruthy(env.FLAG_TRIAL_LENGTH_EXPERIMENT);
  const rawVariant = env.TRIAL_EXPERIMENT_VARIANT ?? "week_beta";
  const variant = isTrialVariant(rawVariant) ? rawVariant : CONTROL_VARIANT;

  const parsed = Number(env.TRIAL_EXPERIMENT_PERCENT ?? "0");
  const percent =
    Number.isInteger(parsed) && parsed >= 0 && parsed <= 100 ? parsed : 0;

  const salt = env.TRIAL_EXPERIMENT_SALT?.trim() || DEFAULT_SALT;

  return {
    // Assigning 0% — or assigning to control — is not a running experiment.
    active: enabled && percent > 0 && variant !== CONTROL_VARIANT,
    variant,
    percent,
    salt,
  };
}

// --- Deterministic assignment -------------------------------------------------

/** FNV-1a (32-bit). Stable across runtimes and needs no crypto import. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Stable 0–99 bucket for a user. Salted so the owner can start a clean second
 * experiment later without reusing the first one's buckets.
 */
export function assignmentBucket(userId: string, salt: string): number {
  return fnv1a(`${salt}:${userId}`) % 100;
}

// --- Resolution ---------------------------------------------------------------

/** The subset of a `subscriptions` row that pins a trial length. */
export interface PinnedTrial {
  trial_variant?: string | null;
  trial_days?: number | null;
}

export interface ResolvedTrial {
  variant: TrialVariant;
  days: number;
  /**
   * pinned  = read back from the user's row; authoritative, never re-derived.
   * assigned = freshly bucketed for a user who has no pinned row yet.
   * control  = no experiment running (the default state).
   */
  source: "pinned" | "assigned" | "control";
}

function pinnedDaysOf(pinned: PinnedTrial | null | undefined): number | null {
  const days = pinned?.trial_days;
  if (typeof days !== "number" || !Number.isInteger(days)) return null;
  if (days < MIN_TRIAL_DAYS || days > MAX_TRIAL_DAYS) return null;
  return days;
}

/**
 * Decide the trial length for a user. Call this on the server only — the
 * result, not the inputs, is what reaches the browser.
 */
export function resolveTrialConfig(args: {
  userId: string;
  pinned?: PinnedTrial | null;
  env?: EnvLike;
}): ResolvedTrial {
  const pinnedDays = pinnedDaysOf(args.pinned);
  if (pinnedDays !== null) {
    // The stored day count is the promise the user was shown. Keep it even if
    // the variant code is no longer in the allowlist.
    return {
      variant: isTrialVariant(args.pinned?.trial_variant)
        ? args.pinned!.trial_variant
        : CONTROL_VARIANT,
      days: pinnedDays,
      source: "pinned",
    };
  }

  const settings = trialExperimentSettings(args.env);
  if (!settings.active) {
    return { variant: CONTROL_VARIANT, days: CONTROL_TRIAL_DAYS, source: "control" };
  }

  const inVariant =
    assignmentBucket(args.userId, settings.salt) < settings.percent;
  const variant = inVariant ? settings.variant : CONTROL_VARIANT;
  return {
    variant,
    days: trialDaysForVariant(variant),
    source: "assigned",
  };
}

/**
 * Trial length for a surface with no known user (anonymous landing, pricing,
 * legal pages). Returns the control length while no experiment is running —
 * so default production copy is unchanged — and `null` once a cohort is being
 * assigned, because the length genuinely is not known until the user is.
 * Copy helpers turn `null` into a truthful "shown before checkout" sentence
 * rather than guessing a number.
 */
export function publicTrialDays(env: EnvLike = process.env): number | null {
  return trialExperimentSettings(env).active ? null : CONTROL_TRIAL_DAYS;
}

// --- Disclosure copy ----------------------------------------------------------

/**
 * The single source of user-facing trial-length wording. Every CTA, headline,
 * banner and email goes through these so a variant can never be described with
 * the other arm's number, and an unknown length never invents one.
 *
 * Deliberately never emits "free week" or "a week free": that claim is only
 * true for the 7-day arm, and `trialLengthLabel(7)` already says "7 days"
 * exactly. Naming the day count keeps both arms symmetrical and checkable.
 */
export function trialLengthLabel(days: number | null): string {
  return days === null ? "a free trial" : `${days} ${days === 1 ? "day" : "days"}`;
}

/** Attributive form, e.g. "3-day" in "your 3-day trial". Null when unknown. */
export function trialLengthAdjective(days: number | null): string | null {
  return days === null ? null : `${days}-day`;
}

/** e.g. "Start 3 days free" / "Start your free trial" (length unknown). */
export function startTrialCta(days: number | null): string {
  return days === null ? "Start your free trial" : `Start ${trialLengthLabel(days)} free`;
}

/** e.g. "3 days free, then €9.99 each month". */
export function trialThenPriceLine(
  days: number | null,
  price: string,
  cadenceWord: "month" | "year"
): string {
  return days === null
    ? `Free trial, then ${price} each ${cadenceWord} — exact length and charge date shown before checkout`
    : `${trialLengthLabel(days)} free, then ${price} each ${cadenceWord}`;
}

/** Sentence for surfaces that describe the offer in prose. */
export function trialOfferSentence(days: number | null): string {
  return days === null
    ? "Premium starts with a free trial when you choose a plan; the exact length and charge date are shown before checkout."
    : `Premium starts with a ${trialLengthLabel(days)} trial when you choose a plan.`;
}

/**
 * Exact charge date for a trial starting now, as a calendar date (YYYY-MM-DD).
 * Computed on the server and sent to the client, so the confirmation card and
 * the checkout session cannot disagree about the date.
 */
export function chargeDateFor(days: number, from: Date = new Date()): string {
  const d = new Date(from.getTime());
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Trial length actually granted, derived from the Stripe dates already stored
 * on the row. This is the truth after a trial exists — used for "your N-day
 * trial" wording so the banner reflects what Stripe really did rather than
 * what the flag says today.
 */
export function trialDaysFromDates(
  start: string | null | undefined,
  end: string | null | undefined
): number | null {
  const a = start ? Date.parse(start) : NaN;
  const b = end ? Date.parse(end) : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  const days = Math.round((b - a) / 86_400_000);
  return days >= MIN_TRIAL_DAYS && days <= MAX_TRIAL_DAYS ? days : null;
}

/**
 * Analytics dimension for a variant. Rides on the existing `experiment` slug
 * property — a variant code and nothing else, so no cohort event can carry
 * user content.
 */
export function experimentProperty(variant: TrialVariant | null | undefined): {
  experiment?: string;
} {
  return isTrialVariant(variant) ? { experiment: `trial_days:${variant}` } : {};
}
