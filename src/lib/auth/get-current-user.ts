import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { devBypassUser } from "@/lib/auth/dev-bypass";
import type { User } from "@supabase/supabase-js";

/** Returns the authenticated user or null. */
export async function getCurrentUser(): Promise<User | null> {
  const bypass = devBypassUser();
  if (bypass) return bypass;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Returns the authenticated user or redirects to /login. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
