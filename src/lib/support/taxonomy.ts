import { z } from "zod";

/**
 * MW-V18-08: server-owned support taxonomy. A small, fixed vocabulary so support
 * load is measurable and comparable across releases. Deliberately carries NO
 * free text — a category and a severity, never what the user actually wrote.
 */

export const SUPPORT_CATEGORIES = [
  "access_auth",
  "billing",
  "plan_generation_failure",
  "repair_confusion",
  "safety_concern",
  "account_deletion",
  "bug",
  "feature_request",
  "other",
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

/** Categories where an unresolved ticket is a launch-severity signal on its own. */
export const CRITICAL_AREAS: SupportCategory[] = ["safety_concern", "billing", "account_deletion"];

export const SUPPORT_SEVERITIES = ["low", "normal", "high", "critical"] as const;
export type SupportSeverity = (typeof SUPPORT_SEVERITIES)[number];

export const SUPPORT_PLANS = ["free", "trial", "paid", "unknown"] as const;
export type SupportPlan = (typeof SUPPORT_PLANS)[number];

export const SUPPORT_STATUSES = ["open", "pending", "resolved", "reopened", "closed"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

/** Statuses that mean the issue is no longer open work. */
export const RESOLVED_STATUSES: SupportStatus[] = ["resolved", "closed"];

/**
 * Import/update payload. No `body`, `subject`, `message` or `email` field exists
 * by construction — the schema itself is the guarantee that content never enters
 * the ledger. Unknown keys are stripped.
 */
export const SupportTicketInput = z
  .object({
    external_ref: z.string().min(1).max(200).optional(),
    dedupe_key: z.string().min(1).max(200),
    account_user_id: z.string().uuid().nullish(),
    category: z.enum(SUPPORT_CATEGORIES),
    severity: z.enum(SUPPORT_SEVERITIES).default("normal"),
    product_area: z.string().max(80).nullish(),
    plan: z.enum(SUPPORT_PLANS).default("unknown"),
    channel: z.string().max(40).nullish(),
    status: z.enum(SUPPORT_STATUSES).default("open"),
    reopened_count: z.number().int().min(0).max(1000).default(0),
    first_response_at: z.string().datetime().nullish(),
    resolved_at: z.string().datetime().nullish(),
    created_at: z.string().datetime().optional(),
  })
  .strict();

export type SupportTicketInputType = z.infer<typeof SupportTicketInput>;
