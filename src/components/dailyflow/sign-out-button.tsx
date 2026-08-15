"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { purgeSensitiveBrowserStorage } from "@/lib/privacy/browser-storage";

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
    // Clear purge-on-sign-out browser storage so the next person on this device
    // cannot resume a previous session's onboarding/deferral state.
    purgeSensitiveBrowserStorage();
    // Local sign-out: deterministically clear THIS device's session and auth
    // cookies without waiting on a global network revoke round-trip. A global
    // revoke can hang or fail on a slow/unreliable connection and leave the auth
    // cookie in place — so the person appears signed out but an authenticated
    // route still renders. Local scope is the correct posture for a per-device
    // sign-out control and clears the cookie regardless of network state.
    await createClient()
      .auth.signOut({ scope: "local" })
      .catch(() => {
        // Ending the local session is what matters to the person holding the
        // phone; a network hiccup must not leave them stuck on a dead button.
      });
    // refresh() clears the cached server components for the signed-in user, so
    // the next render cannot show their data from cache.
    router.replace("/login");
    router.refresh();
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
