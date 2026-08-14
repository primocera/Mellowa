/**
 * Authoritative registry of user-owned data (Prompt 4, audit v5).
 *
 * Export, deletion verification, privacy documentation and the migration
 * contract test all derive from this single list. When a migration adds a
 * table with a user column, it MUST be added here (or explicitly exempted
 * below) — the contract test in tests/privacy-registry.test.ts fails
 * otherwise.
 *
 * Pure module: no server-only imports, so tests can load it directly.
 */

export interface UserTable {
  table: string;
  /** Column holding the owning user's id. */
  column: string;
  /**
   * What happens to rows on account deletion:
   * - cascade: rows are deleted with the auth user
   * - anonymize: user link is set null; row keeps only non-personal data
   */
  onDelete: "cascade" | "anonymize";
}

export const USER_DATA_REGISTRY: UserTable[] = [
  { table: "profiles", column: "id", onDelete: "cascade" },
  { table: "wellbeing_profiles", column: "user_id", onDelete: "cascade" },
  { table: "daily_checkins", column: "user_id", onDelete: "cascade" },
  { table: "daily_plans", column: "user_id", onDelete: "cascade" },
  { table: "generated_meal_cards", column: "user_id", onDelete: "cascade" },
  { table: "weekly_plans", column: "user_id", onDelete: "cascade" },
  { table: "meal_ideas", column: "user_id", onDelete: "cascade" },
  { table: "shopping_lists", column: "user_id", onDelete: "cascade" },
  { table: "favourite_meals", column: "user_id", onDelete: "cascade" },
  { table: "habits", column: "user_id", onDelete: "cascade" },
  { table: "habit_logs", column: "user_id", onDelete: "cascade" },
  { table: "journal_entries", column: "user_id", onDelete: "cascade" },
  { table: "plan_completions", column: "user_id", onDelete: "cascade" },
  { table: "plan_feedback", column: "user_id", onDelete: "cascade" },
  { table: "safety_events", column: "user_id", onDelete: "cascade" },
  { table: "ai_usage_events", column: "user_id", onDelete: "cascade" },
  { table: "app_events", column: "user_id", onDelete: "anonymize" },
  { table: "email_deliveries", column: "user_id", onDelete: "cascade" },
  { table: "user_consents", column: "user_id", onDelete: "cascade" },
  { table: "subscriptions", column: "user_id", onDelete: "cascade" },
  { table: "generation_requests", column: "user_id", onDelete: "cascade" },
  { table: "daily_plan_versions", column: "user_id", onDelete: "cascade" },
  { table: "learned_signal_suppressions", column: "user_id", onDelete: "cascade" },
  { table: "routine_presets", column: "user_id", onDelete: "cascade" },
  { table: "weekly_reflections", column: "user_id", onDelete: "cascade" },
  // MW-V17-06: exactly-once onboarding completion marker (no personal content,
  // just the fact + timestamp). FK ON DELETE CASCADE removes it with the user.
  { table: "onboarding_completions", column: "user_id", onDelete: "cascade" },
];

/**
 * Tables with a user-id-shaped column that intentionally hold NO user-owned
 * personal data and are excluded from export (documented reason required).
 */
export const EXEMPT_TABLES: { table: string; reason: string }[] = [
  {
    table: "stripe_events",
    reason:
      "global webhook event ledger; payloads may reference any customer and are never exported per-user",
  },
  {
    table: "account_flags",
    reason:
      "internal anti-abuse/ops flags set by support; no user-authored content; removed on account deletion via FK cascade (026)",
  },
  {
    table: "account_deletion_requests",
    reason:
      "MW-V18-04 deletion state machine; deliberately has NO auth FK so the job outlives the identity it deletes and can verify residual removal — it must NOT cascade or be exported per-user. user_id is minimised (nulled) at completion and the whole row is purged after retention (purge_completed_deletion_jobs).",
  },
  {
    table: "analytics_excluded_users",
    reason:
      "MW-V18-05 server-owned staff/test/demo cohort-exclusion registry; no user-authored content, service-role only, and deliberately no auth FK so a deleted staff account stays excluded from historical cohort math. Not exported per-user.",
  },
];

/**
 * Data retention rules (Prompt 4). Applied by pruneExpiredData(); documented
 * on the Privacy page. Days are maxima — rows older than this are removed.
 */
export const RETENTION_RULES = [
  {
    table: "safety_events",
    days: 180,
    reason: "crisis excerpt minimization — kept only for safety-system QA",
  },
  {
    table: "app_events",
    days: 365,
    reason: "product analytics",
  },
  {
    table: "email_deliveries",
    days: 90,
    onlyStatuses: ["failed_permanent", "failed_transient", "not_configured"],
    reason: "ops visibility for undelivered email",
  },
] as const;
