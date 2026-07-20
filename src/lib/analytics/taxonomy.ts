import { z } from "zod";

/**
 * Product analytics contract (Launch & Scale v6, Prompt 9). Pure module — no
 * server-only imports, so contract tests and client code can load it directly.
 *
 * Design rules encoded here:
 * - Event names are a fixed, versioned enum. Unknown names are rejected.
 * - Only enumerated property KEYS are allowed; unknown keys are rejected
 *   (`.strict()`). This is the primary guard against ever sending mood values,
 *   allergies, journal or plan contents — those keys simply don't exist.
 * - Property VALUES are enumerated or constrained to non-free-text slugs, so a
 *   sensitive string can't ride in on an allowed key.
 * - Identity/billing/generation outcomes are SERVER-AUTHORITATIVE: the client
 *   event API refuses them. Clients may only describe views/clicks.
 * - The funnel dictionary lets one query reconstruct each canonical funnel.
 */

export const ANALYTICS_VERSION = 1;

/** Fixed event taxonomy. Never rename — add a new name and bump the version. */
export const EVENT_NAMES = [
  "landing_cta_clicked",
  "signup_started",
  "signup_completed",
  "email_verified",
  "onboarding_started",
  "onboarding_completed",
  "sample_plan_requested",
  "sample_plan_generated",
  "sample_plan_opened",
  "paywall_viewed",
  "checkout_started",
  "checkout_completed",
  "trial_started",
  "trial_canceled",
  "cancellation_requested",
  "trial_converted",
  "subscription_renewed",
  "payment_failed",
  "payment_recovered",
  "plan_feedback",
  "account_deleted",
  // Retained operational events from the v4 ledger (still fire server-side).
  "checkin_completed",
  "plan_generated",
  "plan_fallback_served",
  // v8 value loop (MW-S01): the Now view. Views/deferrals are client claims;
  // a completed action is server-confirmed by the plan-completion endpoint.
  "now_viewed",
  "now_action_done",
  "now_action_deferred",
  // v8 value loop (MW-S02): atomic remaining-day repair. All server-emitted —
  // only the route knows whether a repair really committed.
  "plan_repair_requested",
  "plan_repair_completed",
  "plan_repair_failed",
  "plan_repair_undone",
  // v8 (MW-S03): transparent, user-controlled personalization.
  "personalization_viewed",
  "preference_changed",
  "learned_signal_removed",
  // v8 (MW-S04): routine presets. Create/remove are server-confirmed writes;
  // applying is a client-side prefill claim.
  "preset_created",
  "preset_applied",
  "preset_removed",
  // v8 (MW-S05): meal continuity — server-confirmed reuse/draft outcomes.
  "favourite_reused",
  "shopping_draft_built",
  // v8 (MW-S06): weekly reflection and carry-forward.
  "weekly_reflection_started",
  "weekly_reflection_completed",
  "carry_forward_saved",
  "next_week_plan_created",
  // v8 (MW-S07): sample value proof.
  "sample_value_action_completed",
  "premium_value_explained",
  // v8 (MW-S08): consent-based reminders — client claims about settings taps
  // and link opens; delivery truth lives in the email ledger.
  "reminder_enabled",
  "reminder_paused",
  "reminder_disabled",
  "reminder_link_opened",
  // v8 (MW-S09): premium packaging.
  "premium_value_viewed",
  "reactivation_started",
] as const;

export type AppEvent = (typeof EVENT_NAMES)[number];

/**
 * Events whose truth is owned by the server (identity, billing, generation
 * outcomes). The client event endpoint rejects these — a browser can claim a
 * view or click, never a payment or a verified signup.
 */
export const SERVER_AUTHORITATIVE_EVENTS = new Set<AppEvent>([
  "signup_completed",
  "email_verified",
  "sample_plan_generated",
  "checkout_completed",
  "trial_started",
  "trial_canceled",
  "cancellation_requested",
  "trial_converted",
  "subscription_renewed",
  "payment_failed",
  "payment_recovered",
  "plan_feedback",
  "account_deleted",
  "checkin_completed",
  "plan_generated",
  "plan_fallback_served",
  "now_action_done",
  "plan_repair_requested",
  "plan_repair_completed",
  "plan_repair_failed",
  "plan_repair_undone",
  "learned_signal_removed",
  "preset_created",
  "preset_removed",
  "favourite_reused",
  "shopping_draft_built",
  "weekly_reflection_completed",
  "carry_forward_saved",
  "next_week_plan_created",
  "sample_value_action_completed",
  "reactivation_started",
]);

/** Client-describable events (views/clicks). Everything else is server-only. */
export const CLIENT_EVENTS = new Set<AppEvent>(
  EVENT_NAMES.filter((e) => !SERVER_AUTHORITATIVE_EVENTS.has(e))
);

// --- Enumerated / constrained property values ---------------------------------

const SOURCE = ["organic", "ad", "referral", "email", "direct", "unknown"] as const;
const SURFACE = [
  "landing", "pricing", "signup", "login", "verify_email", "onboarding",
  "today", "check_in", "week", "library", "patterns", "paywall", "billing",
  "settings", "email",
] as const;
const PLAN_INTERVAL = ["monthly", "yearly"] as const;
const OUTCOME = ["success", "failure", "blocked", "skipped", "cancelled"] as const;
/** Voluntary = the user chose to leave; involuntary = payment failure ended it. */
const CHURN_TYPE = ["voluntary", "involuntary"] as const;
/** Optional, closed cancellation-reason set — never free text (Prompt 18). */
const CANCEL_REASON = [
  "too_expensive",
  "not_using",
  "missing_features",
  "taking_a_break",
  "other",
] as const;
/** Categorical plan-item type for the Now view (MW-S01) — never item text. */
const ITEM_TYPE = [
  "meal",
  "movement",
  "calm_reset",
  "habit",
  "evening",
  "focus",
] as const;
/** Plan mode category. "unknown" covers legacy plans without a stored mode. */
const PLAN_MODE = ["minimum", "balanced", "reset", "custom", "unknown"] as const;
/** Bounded "Not now" reasons (MW-S01) — a closed set, never free text. */
const DEFER_REASON = [
  "no_time",
  "too_much",
  "not_relevant",
  "already_handled",
] as const;
/** Bounded repair reasons (MW-S02) — categorical, never the user's note. */
const REPAIR_REASON = [
  "less_time",
  "lower_energy",
  "context_changed",
  "meal_not_working",
  "calmer_version",
] as const;

/**
 * Non-free-text slug: lowercase letters, digits, dot, colon and hyphen only,
 * bounded length. Used for campaign / model_version / prompt_version /
 * experiment so a marketing tag or model id passes but prose, emails, mood
 * text or journal content cannot.
 */
const slug = z
  .string()
  .max(64)
  .regex(/^[a-z0-9][a-z0-9.:_-]*$/, "must be a lowercase slug, no free text");

/** Internal route only: an app path, never an absolute URL or query string. */
const route = z
  .string()
  .max(80)
  .regex(/^\/[a-z0-9/_-]*$/, "must be a relative internal path");

/**
 * The complete, closed set of allowed properties. `.strict()` makes any other
 * key a validation error — this is what keeps sensitive fields out.
 */
export const propertiesSchema = z
  .object({
    source: z.enum(SOURCE),
    campaign: slug,
    surface: z.enum(SURFACE),
    plan_interval: z.enum(PLAN_INTERVAL),
    route,
    outcome: z.enum(OUTCOME),
    model_version: slug,
    prompt_version: slug,
    experiment: slug,
    churn_type: z.enum(CHURN_TYPE),
    cancel_reason: z.enum(CANCEL_REASON),
    item_type: z.enum(ITEM_TYPE),
    plan_mode: z.enum(PLAN_MODE),
    defer_reason: z.enum(DEFER_REASON),
    repair_reason: z.enum(REPAIR_REASON),
    /** Hyphen-joined changed-section TYPES (e.g. "meals-movement"), never content. */
    sections: slug,
    /** Canonical learned-signal code (MW-S03), e.g. "too_much" — never text. */
    signal: slug,
    /** Practical day-context category (MW-S04) — never the preset's name. */
    context_type: z.enum([
      "busy",
      "low_capacity",
      "out_of_routine",
      "home",
      "on_the_go",
      "social",
    ]),
  })
  .partial()
  .strict();

export type AnalyticsProperties = z.infer<typeof propertiesSchema>;

export const ALLOWED_PROPERTY_KEYS = Object.keys(
  propertiesSchema.shape
) as (keyof AnalyticsProperties)[];

export const eventNameSchema = z.enum(EVENT_NAMES);

/** Full validated payload accepted by trackEvent / the client endpoint. */
export const eventSchema = z.object({
  event: eventNameSchema,
  properties: propertiesSchema.default({}),
});

export interface ParsedEvent {
  event: AppEvent;
  properties: AnalyticsProperties;
}

/**
 * Validate an untrusted event. Throws ZodError on unknown name, unknown
 * property key, or a value that fails its enum/slug constraint.
 */
export function parseEvent(input: unknown): ParsedEvent {
  return eventSchema.parse(input) as ParsedEvent;
}

// --- Metric dictionary --------------------------------------------------------

/**
 * Canonical funnels. Each is an ordered list of events; one grouped query over
 * app_events reconstructs the funnel without double-counting (count DISTINCT
 * user_id per step). Every referenced event must exist in EVENT_NAMES —
 * enforced by the contract test.
 */
export const FUNNELS = {
  acquisition: [
    "landing_cta_clicked",
    "signup_started",
    "signup_completed",
    "email_verified",
  ],
  activation: [
    "email_verified",
    "onboarding_started",
    "onboarding_completed",
    "sample_plan_requested",
    "sample_plan_generated",
    "sample_plan_opened",
  ],
  monetization: [
    "paywall_viewed",
    "checkout_started",
    "checkout_completed",
    "trial_started",
    "trial_converted",
  ],
  billing_health: [
    "subscription_renewed",
    "payment_failed",
    "payment_recovered",
    "trial_canceled",
    "account_deleted",
  ],
  /**
   * v8 (MW-S10) core value funnel: account → baseline → sample → one Now
   * action → one repair → trial → return check-in → weekly reflection →
   * paid renewal. Value completions are server-confirmed events.
   */
  value_loop: [
    "signup_completed",
    "onboarding_completed",
    "sample_plan_generated",
    "now_action_done",
    "plan_repair_completed",
    "trial_started",
    "checkin_completed",
    "weekly_reflection_completed",
    "subscription_renewed",
  ],
} as const satisfies Record<string, readonly AppEvent[]>;

export type FunnelName = keyof typeof FUNNELS;
