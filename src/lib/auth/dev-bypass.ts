import type { User } from "@supabase/supabase-js";

/**
 * LOCAL DEV ONLY — auth bypass.
 *
 * When DEV_BYPASS_AUTH=1 (and not in production), the app skips Supabase login
 * and runs as the user id in DEV_BYPASS_USER_ID. Combined with the server
 * Supabase client using the service-role key (see lib/supabase/server.ts),
 * this lets you test every page without logging in. NEVER enable in prod.
 */
export function isDevBypassEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.DEV_BYPASS_AUTH === "1" &&
    !!process.env.DEV_BYPASS_USER_ID
  );
}

export function devBypassUser(): User | null {
  if (!isDevBypassEnabled()) return null;
  const id = process.env.DEV_BYPASS_USER_ID as string;
  return {
    id,
    aud: "authenticated",
    role: "authenticated",
    email: "test@mellowa.local",
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  } as User;
}
