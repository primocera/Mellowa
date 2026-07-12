import { createBrowserClient } from "@supabase/ssr";

/** Browser Supabase client — uses only public (anon) credentials. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
