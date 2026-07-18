import "server-only";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";

/**
 * Admin authorization for the dashboard UI (Launch v6, Prompt 10). Real
 * per-user authorization: the caller must be a signed-in Supabase user whose id
 * is in ADMIN_USER_IDS — not merely holding a shared bearer secret. Fail-closed:
 * if no admins are configured, nobody is an admin.
 */

export function isAdminUserId(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const ids = serverEnv.adminUserIds;
  return ids.length > 0 && ids.includes(userId);
}

/** Returns the admin user's id, or null if the caller is not an admin. */
export async function requireAdmin(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return isAdminUserId(user?.id) ? user!.id : null;
}
