import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { RETENTION_RULES } from "./registry";

/**
 * Applies the retention rules from the privacy registry (Prompt 4).
 * Called from the daily cron; failures are logged and never abort the run.
 */
export async function pruneExpiredData(): Promise<Record<string, number>> {
  const admin = createAdminClient();
  const pruned: Record<string, number> = {};
  for (const rule of RETENTION_RULES) {
    const cutoff = new Date(
      Date.now() - rule.days * 24 * 60 * 60 * 1000
    ).toISOString();
    try {
      let q = admin
        .from(rule.table)
        .delete({ count: "exact" })
        .lt("created_at", cutoff);
      if ("onlyStatuses" in rule && rule.onlyStatuses) {
        q = q.in("status", [...rule.onlyStatuses]);
      }
      const { count, error } = await q;
      if (error) throw new Error(error.message);
      pruned[rule.table] = count ?? 0;
    } catch (err) {
      console.error("[privacy] retention prune failed", {
        table: rule.table,
        message: err instanceof Error ? err.message : "unknown",
      });
    }
  }
  return pruned;
}
