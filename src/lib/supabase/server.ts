import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isDevBypassEnabled, devBypassUser } from "@/lib/auth/dev-bypass";

/**
 * Server Supabase client for server components, server actions and
 * route handlers. Runs with the user's session (RLS enforced).
 *
 * In local dev-bypass mode there is no real session, so we fall back to the
 * service-role key. Queries still filter by user_id explicitly, so this just
 * lets the seeded test user's rows be read/written without a login. Prod path
 * is unaffected (isDevBypassEnabled is false when NODE_ENV=production).
 */
export async function createClient() {
  const cookieStore = await cookies();

  const bypass = isDevBypassEnabled();
  const key = bypass
    ? process.env.SUPABASE_SERVICE_ROLE_KEY!
    : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — safe to ignore when the
            // proxy is refreshing sessions.
          }
        },
      },
    }
  );

  // Local dev-bypass: there is no real session, so route handlers that call
  // supabase.auth.getUser() directly would get null → 401. Return the seeded
  // test user instead so every AI/API route works without a login.
  if (bypass) {
    const user = devBypassUser();
    client.auth.getUser = (async () => ({
      data: { user },
      error: null,
    })) as typeof client.auth.getUser;
  }

  return client;
}
