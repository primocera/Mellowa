import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Support console data layer (Launch v6, Prompt 17).
 *
 * Privacy rule: NEVER return user-authored or user-health content of any
 * kind — only account/billing/delivery metadata a support operator needs.
 * Exceptional content access is a manual break-glass
 * procedure (docs/support-runbook.md) — deliberately NOT built into the UI.
 */

export interface SafeUserOverview {
  account: {
    id: string;
    email: string | null;
    createdAt: string | null;
    emailVerified: boolean;
    lastSignInAt: string | null;
  };
  consents: { kind: string; version: string; createdAt: string }[];
  subscription: {
    status: string;
    planName: string | null;
    trialEnd: string | null;
    currentPeriodEnd: string | null;
    stripeCustomerId: string | null;
  } | null;
  flags: { billingReview: boolean; generationDisabled: boolean };
  emailDeliveries: {
    template: string;
    status: string;
    attempts: number;
    lastError: string | null;
    createdAt: string;
  }[];
  generations: {
    route: string;
    status: string | null;
    fallbackUsed: boolean | null;
    createdAt: string;
  }[];
  auditHistory: { action: string; reason: string; createdAt: string }[];
}

export async function findUserIdByEmail(email: string): Promise<string | null> {
  const admin = createAdminClient();
  // profiles.email is synced at signup; avoids paging the auth admin API.
  const { data } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", email.trim())
    .maybeSingle();
  return data?.id ?? null;
}

export async function getUserOverview(userId: string): Promise<SafeUserOverview | null> {
  const admin = createAdminClient();

  const { data: userData } = await admin.auth.admin.getUserById(userId);
  const user = userData?.user;
  if (!user) return null;

  const [consentsRes, subRes, flagsRes, emailsRes, genRes, auditRes] = await Promise.all([
    admin
      .from("user_consents")
      .select("kind, version, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10),
    admin
      .from("subscriptions")
      .select("status, plan_name, trial_end, current_period_end, stripe_customer_id")
      .eq("user_id", userId)
      .maybeSingle(),
    admin.from("account_flags").select("billing_review, generation_disabled").eq("user_id", userId).maybeSingle(),
    admin
      .from("email_deliveries")
      .select("template, status, attempts, last_error, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
    admin
      .from("ai_usage_events")
      .select("route, status, fallback_used, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
    admin
      .from("admin_audit_log")
      .select("action, reason, created_at")
      .eq("target_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return {
    account: {
      id: user.id,
      email: user.email ?? null,
      createdAt: user.created_at ?? null,
      emailVerified: Boolean(user.email_confirmed_at),
      lastSignInAt: user.last_sign_in_at ?? null,
    },
    consents: (consentsRes.data ?? []).map((c) => ({
      kind: c.kind,
      version: c.version,
      createdAt: c.created_at,
    })),
    subscription: subRes.data
      ? {
          status: subRes.data.status,
          planName: subRes.data.plan_name ?? null,
          trialEnd: subRes.data.trial_end ?? null,
          currentPeriodEnd: subRes.data.current_period_end ?? null,
          stripeCustomerId: subRes.data.stripe_customer_id ?? null,
        }
      : null,
    flags: {
      billingReview: flagsRes.data?.billing_review ?? false,
      generationDisabled: flagsRes.data?.generation_disabled ?? false,
    },
    emailDeliveries: (emailsRes.data ?? []).map((e) => ({
      template: e.template,
      status: e.status,
      attempts: e.attempts,
      lastError: e.last_error,
      createdAt: e.created_at,
    })),
    generations: (genRes.data ?? []).map((g) => ({
      route: g.route,
      status: g.status ?? null,
      fallbackUsed: g.fallback_used ?? null,
      createdAt: g.created_at,
    })),
    auditHistory: (auditRes.data ?? []).map((a) => ({
      action: a.action,
      reason: a.reason,
      createdAt: a.created_at,
    })),
  };
}

export async function recordAdminAction(args: {
  actorUserId: string;
  action: string;
  targetUserId?: string | null;
  reason: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("admin_audit_log").insert({
    actor_user_id: args.actorUserId,
    action: args.action,
    target_user_id: args.targetUserId ?? null,
    reason: args.reason,
  });
  if (error) {
    // Auditing must not fail silently — surface loudly in logs.
    console.error("[admin] audit log write failed", { action: args.action, message: error.message });
  }
}

export const ADMIN_ACTIONS = [
  "view_user",
  "resend_verification",
  "replay_failed_emails",
  "flag_billing_review",
  "unflag_billing_review",
  "disable_generation",
  "enable_generation",
] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

/** Generation abuse switch consumed by guardAiRoute. */
export async function isGenerationDisabled(userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("account_flags")
    .select("generation_disabled")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.generation_disabled === true;
}
