"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { trackClient } from "@/lib/analytics/client";

/**
 * Render a server-supplied calendar date (YYYY-MM-DD) in the reader's locale.
 * MW-V10-02: the client no longer derives the charge date from a hardcoded
 * trial length — the date is whatever the checkout route computed for this
 * user's assigned variant, so the two can never disagree.
 */
/**
 * Format the charge date with an EXPLICIT locale.
 *
 * This used to pass `undefined`, which resolves to the runtime's own locale —
 * Node's on the server, the visitor's on the client. Those disagree (en-US
 * "July 30, 2026" versus en-GB "30 July 2026"), and because this line renders
 * on first paint for every trial-eligible viewer, the two HTML versions did not
 * match and React threw hydration error #418 on the pricing page.
 *
 * The mismatched string is "Cancel before {date} to avoid the €9.99 charge" —
 * the one date a user has to be able to trust, briefly rendering as a different
 * date than the server intended.
 *
 * Found by MW-V11-04's console-error guard the first time a trial-eligible
 * fixture existed to render this branch at all. The app is English-only
 * (`docs/localization.md` locks copy until translation), so pinning en-GB is
 * the honest fix; when localization lands, this takes the user's chosen locale
 * from server-provided state rather than from whatever the runtime guesses.
 */
function formatChargeDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-GB", {
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
  trialChargeDate,
  highlight = false,
}: {
  interval: "monthly" | "yearly";
  label: string;
  /** e.g. "$12.99" — shown in the confirmation before redirect. */
  amount: string;
  /** e.g. "/month" — shown after the amount. */
  cadence: string;
  /** Server-derived: false when the user already consumed their one trial. */
  trialEligible?: boolean;
  /**
   * Server-computed charge date (YYYY-MM-DD) for this user's assigned trial
   * length. `null` when the length isn't knowable yet (anonymous visitor while
   * a cohort experiment is running) — the copy then promises the exact date at
   * checkout instead of naming one.
   */
  trialChargeDate?: string | null;
  highlight?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Once we know eligibility + the checkout url, show a confirmation card
  // stating the exact amount and charge date before we redirect to Stripe.
  // Every value in it comes from the checkout response.
  const [confirm, setConfirm] = useState<{
    url: string;
    trial: boolean;
    chargeDate: string;
  } | null>(null);

  useEffect(() => {
    // MW-S09: the Premium value proposition was rendered (highlighted plan
    // only, so a page with two buttons fires once).
    if (highlight) trackClient("premium_value_viewed", { surface: "billing" });
  }, [highlight]);

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
      } else if (data.url && typeof data.chargeDate === "string") {
        setConfirm({
          url: data.url,
          trial: !!data.trial,
          chargeDate: data.chargeDate,
        });
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
            {cadence} on <strong>{formatChargeDate(confirm.chargeDate)}</strong>{" "}
            unless you cancel before then. Your subscription renews
            automatically.
          </p>
        ) : (
          <p className="text-[#1F2937]">
            You&apos;ll be charged <strong>{amount}</strong>
            {cadence}{" "}
            <strong>today ({formatChargeDate(confirm.chargeDate)})</strong>, then
            each{" "}
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
          {trialChargeDate ? (
            <>
              Payment method required. Cancel before{" "}
              {formatChargeDate(trialChargeDate)} to avoid the {amount}
              {cadence} charge.
            </>
          ) : (
            <>
              Payment method required. Your exact trial length and charge date
              are shown before checkout.
            </>
          )}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-[#991B1B]">{error}</p>}
    </div>
  );
}
