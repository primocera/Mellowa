"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/**
 * Sign out, from the account hub.
 *
 * Why this exists: the only sign-out control was in the desktop sidebar, which
 * is `hidden … md:flex`. On a phone there was no way to end the session at all
 * — not in the bottom nav, not on You, not in Settings. For a product holding
 * mood, journal and allergy data on someone's personal device, that is a
 * privacy gap rather than a missing convenience.
 *
 * Deliberately plain: no confirmation dialog. Signing out is reversible by
 * signing back in, and putting a modal in front of the control someone reaches
 * for when handing their phone to somebody else would be the wrong trade.
 */
export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      await createClient().auth.signOut();
      // refresh() clears the cached server components for the signed-in user,
      // so the next render cannot show their data from cache.
      router.replace("/login");
      router.refresh();
    } catch {
      // Ending the local session is the part that matters to the person
      // holding the phone; a network failure must not leave them stuck on a
      // dead button.
      setBusy(false);
      router.replace("/login");
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl border border-[#E5E1DA] bg-white px-4 text-sm font-medium text-[#6B7280] transition hover:border-[#7C9A92]/50 hover:text-[#1F2937] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C9A92] focus-visible:ring-offset-2 disabled:opacity-60 sm:w-auto"
    >
      <LogOut className="h-4 w-4" aria-hidden />
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
