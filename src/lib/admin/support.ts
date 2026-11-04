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
  /**
   * Consent rows (newest first), or null when they could not be read — the
   * console must say "couldn't load", never "none recorded", on a read error.
   */
  consents: { consentType: string; version: string; granted: boolean; createdAt: string }[] | null;
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

export type UserLookupResult =
  | { status: "found"; userId: string }
  | { status: "not_found" }
  | { status: "ambiguous" }
  | { status: "unavailable" };

/** Trimmed, lowercased address — GoTrue stores auth emails lowercased. */
export function normalizeLookupEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Upper bound on the auth-user scan (pages of LOOKUP_PAGE_SIZE). */
const LOOKUP_PAGE_SIZE = 1000;
const LOOKUP_MAX_PAGES = 50;

/**
 * Resolves a support lookup to exactly one account by its AUTH email
 * (auth.users), compared exactly and case-insensitively.
 *
 * profiles.email is user-editable through RLS, so it is NEVER trusted as the
 * identity: it is only a fast-path candidate index (exact `.eq`, no LIKE
 * wildcards), and every candidate is confirmed against the auth record. When
 * no candidate confirms, the auth users are scanned (bounded) for an exact
 * match. Zero matches → not_found; more than one → ambiguous (never pick one);
 * any read error or an exhausted scan bound → unavailable. Fails closed: it
 * never returns a user it could not confirm.
 */
export async function lookupUserByEmail(email: string): Promise<UserLookupResult> {
  const target = normalizeLookupEmail(email);
  if (!target || !target.includes("@")) return { status: "not_found" };
  const admin = createAdminClient();
  const authEmailMatches = (value: string | null | undefined) =>
    typeof value === "string" && value.trim().toLowerCase() === target;

  // Fast path: candidate ids from profiles (exact match on the normalized
  // value), each CONFIRMED against auth.users before it can be returned.
  const { data: candidates, error: candidateErr } = await admin
    .from("profiles")
    .select("id")
    .eq("email", target)
    .limit(5);
  if (candidateErr) {
    console.error("[admin] support lookup: profiles read failed", { code: candidateErr.code });
    return { status: "unavailable" };
  }
  const confirmed = new Set<string>();
  for (const row of (candidates ?? []) as { id: string }[]) {
    const { data, error } = await admin.auth.admin.getUserById(row.id);
    if (error) {
      // A missing auth user is just a stale profile; anything else is unknown.
      if (error.status === 404) continue;
      console.error("[admin] support lookup: auth read failed", { status: error.status });
      return { status: "unavailable" };
    }
    if (data?.user && authEmailMatches(data.user.email)) confirmed.add(data.user.id);
  }
  if (confirmed.size === 1) return { status: "found", userId: [...confirmed][0] };
  if (confirmed.size > 1) return { status: "ambiguous" };

  // Slow path: the account's profile email may have been edited away from its
  // auth email. Scan the auth users (bounded) for an exact match.
  const matches = new Set<string>();
  for (let page = 1; page <= LOOKUP_MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: LOOKUP_PAGE_SIZE });
    if (error) {
      console.error("[admin] support lookup: auth scan failed", { status: error.status });
      return { status: "unavailable" };
    }
    const users = data?.users ?? [];
    for (const u of users) if (authEmailMatches(u.email)) matches.add(u.id);
    if (users.length < LOOKUP_PAGE_SIZE) {
      if (matches.size === 1) return { status: "found", userId: [...matches][0] };
      return matches.size > 1 ? { status: "ambiguous" } : { status: "not_found" };
    }
  }
  // Scan bound reached without seeing the end: an absent match is unknown, not
  // "no account".
  if (matches.size === 1) return { status: "found", userId: [...matches][0] };
  return matches.size > 1 ? { status: "ambiguous" } : { status: "unavailable" };
}

export async function getUserOverview(userId: string): Promise<SafeUserOverview | null> {
  const admin = createAdminClient();

  const { data: userData } = await admin.auth.admin.getUserById(userId);
  const user = userData?.user;
  if (!user) return null;

  const [consentsRes, subRes, flagsRes, emailsRes, genRes, auditRes] = await Promise.all([
    admin
      .from("user_consents")
      .select("consent_type, version, granted, created_at")
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

  if (consentsRes.error) {
    console.error("[admin] support overview: consents read failed", { code: consentsRes.error.code });
  }

  return {
    account: {
      id: user.id,
      email: user.email ?? null,
      createdAt: user.created_at ?? null,
      emailVerified: Boolean(user.email_confirmed_at),
      lastSignInAt: user.last_sign_in_at ?? null,
    },
    consents: consentsRes.error
      ? null
      : (consentsRes.data ?? []).map((c) => ({
          consentType: c.consent_type,
          version: c.version,
          granted: c.granted !== false,
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

/**
 * Generation abuse switch consumed by guardAiRoute. Fails CLOSED: if the flag
 * cannot be read, generation is treated as disabled (a transient pause beats
 * letting a disabled account keep spending provider calls).
 */
export async function isGenerationDisabled(userId: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("account_flags")
      .select("generation_disabled")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      console.error("[admin] generation flag read failed — failing closed", { code: error.code });
      return true;
    }
    return data?.generation_disabled === true;
  } catch (err) {
    console.error("[admin] generation flag read threw — failing closed", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return true;
  }
}
