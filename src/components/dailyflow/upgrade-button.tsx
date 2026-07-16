"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { TRIAL_DAYS } from "@/lib/stripe/plans";

/** Human-readable local date, e.g. "18 July 2026". */
function formatChargeDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function UpgradeButton({
  interval,
  label,
  amount,
  cadence,
  trialEligible,
  highlight = false,
}: {
  interval: "monthly" | "yearly";
  label: string;
  /** e.g. "€9.99" — shown in the confirmation before redirect. */
  amount: string;
  /** e.g. "/month" — shown after the amount. */
  cadence: string;
  /** Server-derived: false when the user already consumed their one trial. */
  trialEligible?: boolean;
  highlight?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Once we know eligibility + the checkout url, show a confirmation card
  // stating the exact amount and charge date before we redirect to Stripe.
  const [confirm, setConfirm] = useState<{ url: string; trial: boolean } | null>(
    null
  );

  async function start() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval }),
      });
      const data = await res.json();
      if (res.status === 401) {
        router.push("/signup");
        return;
      }
      if (data.error === "already_subscribed") {
        setError("You already have an active subscription.");
      } else if (data.error === "email_unverified") {
        setError("Please confirm your email address first, then try again.");
      } else if (data.url) {
        setConfirm({ url: data.url, trial: !!data.trial });
      } else {
        setError("Couldn't start checkout — please try again.");
      }
    } catch {
      setError("Couldn't start checkout — please try again.");
    }
    setLoading(false);
  }

  const buttonClass = highlight
    ? "flex w-full items-center justify-center gap-2 rounded-xl bg-[#7C9A92] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#6D8C7D] disabled:opacity-70"
    : "flex w-full items-center justify-center gap-2 rounded-xl border border-[#E5E1DA] bg-white px-4 py-3 text-sm font-medium text-[#1F2937] transition hover:border-[#7C9A92]/50 disabled:opacity-70";

  if (confirm) {
    return (
      <div className="rounded-xl border border-[#E5E1DA] bg-[#FAF7F2] p-4 text-sm">
        {confirm.trial ? (
          <p className="text-[#1F2937]">
            Payment method required. You&apos;ll be charged{" "}
            <strong>{amount}</strong>
            {cadence} on <strong>{formatChargeDate(TRIAL_DAYS)}</strong> unless
            you cancel before then. Your subscription renews automatically.
          </p>
        ) : (
          <p className="text-[#1F2937]">
            You&apos;ll be charged <strong>{amount}</strong>
            {cadence} <strong>today ({formatChargeDate(0)})</strong>, then each{" "}
            {interval === "monthly" ? "month" : "year"}.
          </p>
        )}
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => (window.location.href = confirm.url)}
            className={buttonClass}
          >
            Continue to secure checkout
          </button>
          <button
            onClick={() => setConfirm(null)}
            className="rounded-xl px-3 py-3 text-sm text-[#6B7280] hover:text-[#1F2937]"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button onClick={start} disabled={loading} className={buttonClass}>
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {label}
      </button>
      {trialEligible !== false && (
        <p className="mt-2 text-xs text-[#6B7280]">
          Payment method required. Cancel before{" "}
          {formatChargeDate(TRIAL_DAYS)} to avoid the {amount}
          {cadence} charge.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-[#991B1B]">{error}</p>}
    </div>
  );
}
