"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const ACTION_LABELS: Record<string, string> = {
  resend_verification: "Resend verification",
  replay_failed_emails: "Replay failed emails",
  flag_billing_review: "Flag for billing review",
  unflag_billing_review: "Clear billing review",
  disable_generation: "Disable generation (abuse)",
  enable_generation: "Re-enable generation",
};

/**
 * Safe admin actions with a mandatory reason (audited server-side). Destructive
 * actions (the permission matrix's step-up set) need a second, explicit
 * confirmation before the request is sent with `step_up_confirmed: true`; the
 * server re-checks role, reason and step-up and refuses otherwise.
 */
export function UserActions({
  targetUserId,
  verified,
  flags,
  role,
  stepUpActions,
}: {
  targetUserId: string;
  verified: boolean;
  flags: { billingReview: boolean; generationDisabled: boolean };
  role: "viewer" | "operator" | "owner";
  stepUpActions: string[];
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const readOnly = role === "viewer";

  async function send(action: string, stepUpConfirmed: boolean) {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/admin/user-actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        target_user_id: targetUserId,
        reason,
        step_up_confirmed: stepUpConfirmed,
      }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    setPending(null);
    setMessage(res?.ok ? `Done: ${action}` : `Failed: ${data.error ?? res?.status ?? "network"}`);
    router.refresh();
  }

  function run(action: string) {
    if (reason.trim().length < 3) {
      setMessage("A reason is required for every action.");
      return;
    }
    if (stepUpActions.includes(action)) {
      // Destructive: ask for an explicit second confirmation first.
      setMessage(null);
      setPending(action);
      return;
    }
    void send(action, false);
  }

  const btn =
    "min-h-[44px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50";

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="mb-2 font-medium">Actions</h2>
      {readOnly && (
        <p className="mb-3 text-sm text-[#6B7280]">
          Your admin role is read-only, so actions are unavailable.
        </p>
      )}
      <label className="mb-3 block text-sm">
        <span className="text-[#6B7280]">Reason (recorded in the audit log)</span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2"
          placeholder="e.g. user reported missing verification email"
          maxLength={500}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {!verified && (
          <button className={btn} disabled={busy || readOnly} onClick={() => run("resend_verification")}>
            {ACTION_LABELS.resend_verification}
          </button>
        )}
        <button className={btn} disabled={busy || readOnly} onClick={() => run("replay_failed_emails")}>
          {ACTION_LABELS.replay_failed_emails}
        </button>
        <button
          className={btn}
          disabled={busy || readOnly}
          onClick={() => run(flags.billingReview ? "unflag_billing_review" : "flag_billing_review")}
        >
          {flags.billingReview ? ACTION_LABELS.unflag_billing_review : ACTION_LABELS.flag_billing_review}
        </button>
        <button
          className={btn}
          disabled={busy || readOnly}
          onClick={() => run(flags.generationDisabled ? "enable_generation" : "disable_generation")}
        >
          {flags.generationDisabled ? ACTION_LABELS.enable_generation : ACTION_LABELS.disable_generation}
        </button>
      </div>
      {pending && (
        <div className="mt-3 rounded-xl bg-[#FEE2E2] p-3 text-sm text-[#991B1B]" role="alertdialog" aria-label="Confirm action">
          <p>
            Confirm &ldquo;{ACTION_LABELS[pending] ?? pending}&rdquo; for this account? It changes the
            account and is recorded in the audit log.
          </p>
          <div className="mt-2 flex gap-2">
            <button className={btn} disabled={busy} onClick={() => void send(pending, true)}>
              Yes, confirm
            </button>
            <button className={btn} disabled={busy} onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {message && <p className="mt-3 text-sm text-[#6B7280]" role="status">{message}</p>}
    </section>
  );
}
