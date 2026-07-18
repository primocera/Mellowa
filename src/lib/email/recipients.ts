import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk } from "@/lib/email/reminder-planner";

/**
 * Batched recipient lookup (Launch v6, Prompt 15). One get_user_emails RPC
 * per chunk of 500 ids instead of one auth admin HTTP call per user.
 */
export async function getUserEmails(
  admin: SupabaseClient,
  userIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const ids of chunk(userIds, 500)) {
    const { data, error } = await admin.rpc("get_user_emails", {
      p_user_ids: ids,
    });
    if (error) {
      console.error("[email] get_user_emails failed", { message: error.message });
      continue; // affected users are retried on the next run
    }
    for (const row of (data ?? []) as { user_id: string; email: string | null }[]) {
      if (row.email) map.set(row.user_id, row.email);
    }
  }
  return map;
}
