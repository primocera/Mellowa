"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/**
 * Billing management actions (Prompt 15): open the Stripe Billing Portal
 * (invoices, payment method), cancel at period end, reactivate.
 */
export function ManageBilling({
  cancelAtPeriodEnd,
  periodEndLabel,
  canCancel,
}: {
  cancelAtPeriodEnd: boolean;
  /** Formatted date the current period/trial ends, for the cancel copy. */
  periodEndLabel: string | null;
  /** trialing/active/past_due — statuses where cancel/reactivate makes sense. */
  canCancel: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"portal" | "cancel" | "reactivate" | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openPortal() {
    setBusy("portal");
    setError(null);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      setError("Couldn't open billing management — please try again.");
    } catch {
      setError("Couldn't open billing management — please try again.");
    }
    setBusy(null);
  }

  async function setCancel(action: "cancel" | "reactivate") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch("/api/stripe/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.ok) {
        setConfirmCancel(false);
        router.refresh();
      } else {
        setError(data.error ?? "Couldn't update your subscription.");
      }
    } catch {
      setError("Couldn't update your subscription — please try again.");
    }
    setBusy(null);
  }

  const secondaryBtn =
    "flex w-full items-center justify-center gap-2 rounded-xl border border-[#E5E1DA] bg-white px-4 py-2.5 text-sm font-medium text-[#1F2937] transition hover:border-[#7C9A92]/50 disabled:opacity-70";

  return (
    <div className="mt-4 space-y-2">
      <button onClick={openPortal} disabled={busy !== null} className={secondaryBtn}>
        {busy === "portal" && <Loader2 className="h-4 w-4 animate-spin" />}
        Manage payment method &amp; invoices
      </button>

      {canCancel && !cancelAtPeriodEnd && !confirmCancel && (
        <button
          onClick={() => setConfirmCancel(true)}
          className="w-full rounded-xl px-4 py-2 text-sm text-[#6B7280] transition hover:text-[#991B1B]"
        >
          Cancel subscription
        </button>
      )}

      {confirmCancel && (
        <div className="rounded-xl border border-[#E5E1DA] bg-[#FAF7F2] p-4 text-sm">
          <p className="text-[#1F2937]">
            Your access continues until{" "}
            <strong>{periodEndLabel ?? "the end of the current period"}</strong>,
            then it won&apos;t renew. Nothing else changes today.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setCancel("cancel")}
              disabled={busy !== null}
              className="flex items-center gap-2 rounded-xl bg-[#991B1B] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#7F1D1D] disabled:opacity-70"
            >
              {busy === "cancel" && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm cancellation
            </button>
            <button
              onClick={() => setConfirmCancel(false)}
              className="rounded-xl px-3 py-2 text-sm text-[#6B7280] hover:text-[#1F2937]"
            >
              Keep my plan
            </button>
          </div>
        </div>
      )}

      {canCancel && cancelAtPeriodEnd && (
        <div className="rounded-xl bg-[#FEE2E2]/60 p-4 text-sm">
          <p className="text-[#1F2937]">
            Your subscription is set to end
            {periodEndLabel ? ` on ${periodEndLabel}` : " at the period end"}. You
            keep full access until then.
          </p>
          <button
            onClick={() => setCancel("reactivate")}
            disabled={busy !== null}
            className="mt-2 flex items-center gap-2 rounded-xl bg-[#7C9A92] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#6D8C7D] disabled:opacity-70"
          >
            {busy === "reactivate" && <Loader2 className="h-4 w-4 animate-spin" />}
            Reactivate subscription
          </button>
        </div>
      )}

      {error && <p className="text-xs text-[#991B1B]">{error}</p>}
    </div>
  );
}
