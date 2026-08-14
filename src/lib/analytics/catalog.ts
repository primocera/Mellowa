import {
  ANALYTICS_VERSION,
  EVENT_NAMES,
  SERVER_AUTHORITATIVE_EVENTS,
  FUNNELS,
  type AppEvent,
} from "@/lib/analytics/taxonomy";

/**
 * MW-V18-X01: the canonical, versioned event catalog.
 *
 * The taxonomy (taxonomy.ts) already fixes the names, the server/client
 * partition and the strict property schema. This publishes the remaining
 * contract each event needs: its OWNER, its TRIGGER, its PRIVACY CLASS, its
 * DEDUPE KEY, and — crucially — its SOURCE OF TRUTH. A client event can describe
 * an interaction, but the durable business fact (money, identity, deletion,
 * value milestone) is proven by a server system, never by app_events.
 *
 * `authority` is DERIVED from SERVER_AUTHORITATIVE_EVENTS, so there is exactly
 * one source of truth for who may emit an event and this catalog can never
 * contradict it. The contract test asserts completeness and consistency.
 *
 * This is not a second analytics pipeline — it is the specification OF the one
 * pipeline that already exists.
 */

export const CATALOG_VERSION = ANALYTICS_VERSION;

export type PrivacyClass =
  | "identity"
  | "billing"
  | "value"
  | "engagement"
  | "operational";

export type EventOwner = "growth" | "billing" | "product" | "platform";

export interface EventSpec {
  owner: EventOwner;
  privacyClass: PrivacyClass;
  /** What real-world action fires it. */
  trigger: string;
  /** "server" = only the server may assert it; "client" = a view/click claim. */
  authority: "server" | "client";
  /** The durable system that PROVES the fact (never app_events for a business fact). */
  sourceOfTruth: string;
  /** How duplicates are collapsed when counting. */
  dedupeKey: string;
}

/**
 * Per-event classification. `authority` is intentionally NOT stored here — it is
 * derived below from SERVER_AUTHORITATIVE_EVENTS to prevent a second, divergent
 * source of truth.
 */
type Classification = Omit<EventSpec, "authority">;

const IDENTITY = "supabase auth + profiles (server write)";
const BILLING = "stripe + subscriptions (webhook, server-authoritative)";
const DELETION = "account_deletion_requests state machine (server)";
const DOMAIN = "owning domain table (server write)";
const INTERACTION = "app_events interaction row (not a business fact)";

const server = (
  owner: EventOwner,
  privacyClass: PrivacyClass,
  trigger: string,
  sourceOfTruth: string
): Classification => ({
  owner,
  privacyClass,
  trigger,
  sourceOfTruth,
  dedupeKey: "user_id + event; the server write is the exactly-once authority",
});

const client = (trigger: string, owner: EventOwner = "product"): Classification => ({
  owner,
  privacyClass: "engagement",
  trigger,
  sourceOfTruth: INTERACTION,
  dedupeKey: "distinct (user_id|anon_id) + event + surface per local day (best-effort)",
});

const CLASS: Record<AppEvent, Classification> = {
  // identity
  signup_completed: server("platform", "identity", "account created", IDENTITY),
  email_verified: server("platform", "identity", "email confirmed", IDENTITY),
  onboarding_completed: server("product", "identity", "wellbeing baseline saved", "onboarding_completions (server)"),
  account_deleted: server("platform", "identity", "deletion job completed", DELETION),
  // billing
  checkout_completed: server("billing", "billing", "checkout session completed", BILLING),
  trial_started: server("billing", "billing", "trial began at checkout", BILLING),
  trial_canceled: server("billing", "billing", "trial canceled", BILLING),
  cancellation_requested: server("billing", "billing", "cancel requested", BILLING),
  trial_converted: server("billing", "billing", "first charge after trial", BILLING),
  subscription_renewed: server("billing", "billing", "renewal invoice paid", BILLING),
  payment_failed: server("billing", "billing", "invoice payment failed", BILLING),
  payment_recovered: server("billing", "billing", "failed payment recovered", BILLING),
  payment_refunded: server("billing", "billing", "charge refunded", BILLING),
  payment_disputed: server("billing", "billing", "charge disputed", BILLING),
  reactivation_started: server("billing", "billing", "reactivation checkout begun", BILLING),
  // value milestones (server-confirmed)
  sample_plan_generated: server("product", "value", "sample plan generated", DOMAIN),
  plan_generated: server("product", "value", "daily plan generated", DOMAIN),
  plan_fallback_served: server("product", "value", "deterministic fallback served", DOMAIN),
  checkin_completed: server("product", "value", "check-in saved", DOMAIN),
  now_action_done: server("product", "value", "plan item completed", DOMAIN),
  plan_repair_requested: server("product", "value", "repair requested", DOMAIN),
  plan_repair_completed: server("product", "value", "remaining-day repair committed", DOMAIN),
  plan_repair_failed: server("product", "value", "repair failed", DOMAIN),
  plan_repair_undone: server("product", "value", "repair undone (free)", DOMAIN),
  weekly_reflection_completed: server("product", "value", "weekly closeout finished", DOMAIN),
  carry_forward_saved: server("product", "value", "carry-forward accepted", DOMAIN),
  next_week_plan_created: server("product", "value", "next-week plan created", DOMAIN),
  sample_value_action_completed: server("product", "value", "sample value action done", DOMAIN),
  favourite_reused: server("product", "value", "favourite meal reused", DOMAIN),
  shopping_draft_built: server("product", "value", "shopping draft built", DOMAIN),
  preset_created: server("product", "value", "routine preset created", DOMAIN),
  preset_removed: server("product", "value", "routine preset removed", DOMAIN),
  learned_signal_removed: server("product", "value", "learned preference removed", DOMAIN),
  plan_feedback: server("product", "value", "plan feedback submitted", DOMAIN),
  // engagement (client view/click claims)
  landing_cta_clicked: client("landing CTA clicked", "growth"),
  signup_started: client("signup form opened", "growth"),
  onboarding_started: client("onboarding opened"),
  sample_plan_requested: client("sample requested (pre-generation)"),
  sample_plan_opened: client("sample plan opened"),
  paywall_viewed: client("paywall rendered", "billing"),
  checkout_started: client("checkout opened", "billing"),
  now_viewed: client("Now view opened"),
  now_action_deferred: client("Now item deferred"),
  personalization_viewed: client("personalization view opened"),
  preference_changed: client("preference toggled"),
  preset_applied: client("preset prefilled (client)"),
  reminder_enabled: client("reminder enabled (settings)"),
  reminder_paused: client("reminder paused (settings)"),
  reminder_disabled: client("reminder disabled (settings)"),
  reminder_link_opened: client("reminder link opened"),
  premium_value_viewed: client("premium value shown", "billing"),
  premium_value_explained: client("premium value explainer shown", "billing"),
  primary_nav_viewed: client("primary destination opened"),
  trial_week_preview_viewed: client("week-closeout example shown", "billing"),
  checkin_started: client("check-in opened"),
  weekly_reflection_started: client("weekly closeout opened"),
};

/** The published catalog: classification + derived authority. */
export const EVENT_CATALOG: Record<AppEvent, EventSpec> = Object.fromEntries(
  EVENT_NAMES.map((e) => [
    e,
    { ...CLASS[e], authority: SERVER_AUTHORITATIVE_EVENTS.has(e) ? "server" : "client" },
  ])
) as Record<AppEvent, EventSpec>;

/**
 * North-star. Not page views or raw generations: an activated user who receives
 * and ADAPTS a realistic plan and returns to meaningful weekly continuity. The
 * proof is the server-confirmed value-loop funnel plus the durable cohort's D2/D3
 * return, repair repeat and weekly carry-forward — every one a server fact.
 */
export const NORTH_STAR = {
  version: CATALOG_VERSION,
  statement:
    "Activated users receive and adapt a realistic daily plan and return to meaningful weekly continuity.",
  funnel: "value_loop" as const,
  provingEvents: [
    "checkin_completed",
    "now_action_done",
    "plan_repair_completed",
    "weekly_reflection_completed",
    "subscription_renewed",
  ] satisfies AppEvent[],
  cohortMetrics: ["d2_return", "d3_return", "repeat_repair_distinct_day", "carry_forward_accepted", "first_renewal"],
} as const;

/** Privacy classes whose truth must NEVER come from app_events alone. */
export const BUSINESS_FACT_CLASSES: PrivacyClass[] = ["identity", "billing", "value"];

// Referenced so the funnel dictionary stays coupled to the catalog version.
export const CATALOG_FUNNELS = FUNNELS;
