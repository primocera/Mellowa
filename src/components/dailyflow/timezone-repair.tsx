"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/**
 * Timezone repair prompt (Prompt 9, audit v5). Shown when the stored
 * timezone is missing or invalid — without it, Today and reminders can land
 * on the wrong local day. One tap stores the browser's IANA timezone.
 */
export function TimezoneRepair() {
  const suggested =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "";
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done || !suggested) return null;

  async function save() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error: dbError } = await supabase
      .from("wellbeing_profiles")
      .update({ timezone: suggested })
      .eq("user_id", user.id);
    if (dbError) {
      setError("Couldn't save your timezone — please try again.");
      setBusy(false);
      return;
    }
    setDone(true);
    window.location.reload();
  }

  return (
    <div className="rounded-2xl border border-[#E5E1DA] bg-[#FEF3C7]/50 p-4 text-sm">
      <p className="text-[#1F2937]">
        We don&apos;t know your timezone yet, so your plan and reminders may
        show on the wrong day. Use <strong>{suggested}</strong>?
      </p>
      <button
        onClick={save}
        disabled={busy}
        className="mt-2 flex items-center gap-2 rounded-xl bg-[#7C9A92] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#6D8C7D] disabled:opacity-60"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Yes, use this timezone
      </button>
      {error && <p className="mt-2 text-xs text-[#991B1B]">{error}</p>}
    </div>
  );
}
