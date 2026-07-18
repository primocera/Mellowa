"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Safe admin actions with a mandatory reason (audited server-side). */
export function UserActions({
  targetUserId,
  verified,
  flags,
}: {
  targetUserId: string;
  verified: boolean;
  flags: { billingReview: boolean; generationDisabled: boolean };
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run(action: string) {
    if (reason.trim().length < 3) {
      setMessage("A reason is required for every action.");
      return;
    }
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/admin/user-actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, target_user_id: targetUserId, reason }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    setMessage(res.ok ? `Done: ${action}` : `Failed: ${data.error ?? res.status}`);
    router.refresh();
  }

  const btn =
    "rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50";

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="mb-2 font-medium">Actions</h2>
      <label className="mb-3 block text-sm">
        <span className="text-[#6B7280]">Reason (recorded in the audit log)</span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2"
          placeholder="e.g. user reported missing verification email"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {!verified && (
          <button className={btn} disabled={busy} onClick={() => run("resend_verification")}>
            Resend verification
          </button>
        )}
        <button className={btn} disabled={busy} onClick={() => run("replay_failed_emails")}>
          Replay failed emails
        </button>
        <button
          className={btn}
          disabled={busy}
          onClick={() => run(flags.billingReview ? "unflag_billing_review" : "flag_billing_review")}
        >
          {flags.billingReview ? "Clear billing review" : "Flag for billing review"}
        </button>
        <button
          className={btn}
          disabled={busy}
          onClick={() => run(flags.generationDisabled ? "enable_generation" : "disable_generation")}
        >
          {flags.generationDisabled ? "Re-enable generation" : "Disable generation (abuse)"}
        </button>
      </div>
      {message && <p className="mt-3 text-sm text-[#6B7280]" role="status">{message}</p>}
    </section>
  );
}
