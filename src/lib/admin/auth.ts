import "server-only";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import type { AdminRole } from "@/lib/admin/permissions";

/**
 * Admin authorization for the dashboard UI (Launch v6, Prompt 10). Real
 * per-user authorization: the caller must be a signed-in Supabase user whose id
 * is in ADMIN_USER_IDS — not merely holding a shared bearer secret. Fail-closed:
 * if no admins are configured, nobody is an admin.
 *
 * Roles (least-privilege matrix in lib/admin/permissions.ts) come from
 * ADMIN_ROLES, a comma-separated `<user-id>:<role>` list, e.g.
 *   ADMIN_ROLES=1111…:owner,2222…:viewer
 * An admin listed in ADMIN_USER_IDS with NO ADMIN_ROLES entry gets
 * DEFAULT_ADMIN_ROLE ("operator"): enough for the day-to-day support console
 * actions, but NOT the owner-only data jobs (onboarding backfill), which need an
 * explicit `:owner` entry. A malformed or unknown role value never elevates — it
 * resolves to "viewer" (read-only). ADMIN_ROLES never grants admin by itself:
 * an id must also be in ADMIN_USER_IDS.
 */

export const DEFAULT_ADMIN_ROLE: AdminRole = "operator";
const VALID_ROLES = new Set<AdminRole>(["viewer", "operator", "owner"]);

export function isAdminUserId(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const ids = serverEnv.adminUserIds;
  return ids.length > 0 && ids.includes(userId);
}

/**
 * Pure parser for ADMIN_ROLES. Entries that are not `<id>:<role>` are skipped;
 * an entry with an unknown role maps that id to "viewer" (fail closed — a typo
 * must never fall back to the more privileged default). If an id is listed more
 * than once, the LEAST privileged role wins.
 */
export function parseAdminRoles(raw: string | null | undefined): Map<string, AdminRole> {
  const rank: Record<AdminRole, number> = { viewer: 0, operator: 1, owner: 2 };
  const roles = new Map<string, AdminRole>();
  for (const entry of (raw ?? "").split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const sep = trimmed.lastIndexOf(":");
    if (sep <= 0) continue;
    const id = trimmed.slice(0, sep).trim();
    const value = trimmed.slice(sep + 1).trim().toLowerCase();
    if (!id) continue;
    const role: AdminRole = VALID_ROLES.has(value as AdminRole) ? (value as AdminRole) : "viewer";
    const prev = roles.get(id);
    roles.set(id, prev && rank[prev] < rank[role] ? prev : role);
  }
  return roles;
}

/**
 * The role of an admin user, or null when the id is not an admin at all.
 * Reads ADMIN_ROLES at call time so a config change takes effect on the next
 * request.
 */
export function adminRoleFor(userId: string | null | undefined): AdminRole | null {
  if (!isAdminUserId(userId)) return null;
  return parseAdminRoles(process.env.ADMIN_ROLES).get(userId!) ?? DEFAULT_ADMIN_ROLE;
}

/** Returns the admin user's id, or null if the caller is not an admin. */
export async function requireAdmin(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return isAdminUserId(user?.id) ? user!.id : null;
}

/**
 * Like requireAdmin, but also resolves the caller's role for checkPermission.
 * Null when the caller is not an admin.
 */
export async function requireAdminWithRole(): Promise<{ id: string; role: AdminRole } | null> {
  const id = await requireAdmin();
  if (!id) return null;
  const role = adminRoleFor(id);
  return role ? { id, role } : null;
}
