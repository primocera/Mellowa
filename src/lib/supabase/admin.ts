import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

/**
 * SERVER-ONLY admin client using the service role key.
 * Bypasses RLS — use only where strictly necessary (e.g. Stripe webhooks,
 * safety event logging). NEVER import from client components.
 */
export function createAdminClient() {
  return createClient(serverEnv.supabaseUrl, serverEnv.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
