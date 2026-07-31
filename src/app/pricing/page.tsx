import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { PRICING, premiumProblemFor } from "@/lib/stripe/plans";
import { UpgradeButton } from "@/components/dailyflow/upgrade-button";
import { isYearlyEmphasisEnabled } from "@/lib/flags";
import { trialDisclosureForViewer } from "@/lib/stripe/trial-disclosure";
import {
  startTrialCta,
  trialLengthLabel,
  trialThenPriceLine,
} from "@/lib/stripe/trial-experiment";

export const metadata: Metadata = {
  title: "Pricing — Mellowa",
  alternates: { canonical: "/pricing" },
};

function FeatureList({ features }: { features: readonly string[] }) {
  return (
    <ul className="mt-4 space-y-3">
      {features.map((f) => {
        // MW-V12-06: name the problem each capability solves, so the paywall
        // reads as reasons to want Premium rather than a list of features.
        const problem = premiumProblemFor(f);
        return (
          <li key={f} className="flex items-start gap-2 text-sm text-[#1F2937]">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#7C9A92]" />
            <span>
              {f}
              {problem && (
                <span className="mt-0.5 block text-xs text-[#6B7280]">{problem}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default async function PricingPage() {
  // A user who already consumed their one trial must see "Pay today" copy, not
  // trial copy (Prompt 3). MW-V10-02: the trial LENGTH and charge date come
  // from the same server resolution, so a cohort never sees the other arm's
  // number. The checkout route re-checks both server-side either way.
  const { trialEligible, days: trialDays, chargeDate } =
    await trialDisclosureForViewer();
  // MW-V9-08: by default (flag OFF) Monthly is presented first and carries the
  // visual emphasis; we don't aggressively steer to Yearly until retention and
  // unit economics justify it. FLAG_EMPHASIZE_YEARLY=1 flips the emphasis.
  const emphasizeYearly = isYearlyEmphasisEnabled();
  return (
    <div className="min-h-screen bg-[#FAF7F2] px-6 py-12">
      {/* MW-V10-07: main landmark — see src/app/page.tsx. */}
      <main id="main" className="mx-auto max-w-3xl">
        <div className="text-center">
          {/* MW-V10-07: 44px — this is the only way back from Pricing. */}
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center rounded-lg px-2 text-lg font-semibold tracking-tight text-[#1F2937] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C9A92] focus-visible:ring-offset-2"
          >
            Mellowa
          </Link>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight text-[#1F2937]">
            {trialEligible
              ? trialDays === null
                ? "Try the full Mellowa rhythm."
                : `Try the full Mellowa rhythm for ${trialLengthLabel(trialDays)}.`
              : "Choose the plan that fits now."}
          </h1>
          <p className="mt-2 text-[#6B7280]">
            {trialEligible
              ? "Both plans include the same Premium features. Choose how often you want to be billed."
              : "You've already used your free trial, so billing begins today. The exact amount is shown before checkout."}
          </p>
        </div>

        <div className="mx-auto mt-10 grid max-w-2xl gap-4 md:grid-cols-2">
          {/* Monthly */}
          <div
            className={
              emphasizeYearly
                ? "rounded-2xl bg-white p-6 shadow-sm"
                : "rounded-2xl border-2 border-[#7C9A92] bg-white p-6 shadow-sm"
            }
          >
            <h2 className="font-medium text-[#1F2937]">{PRICING.monthly.name}</h2>
            <p className="mt-1 text-3xl font-semibold text-[#1F2937]">
              {PRICING.monthly.price}
              <span className="text-base font-normal text-[#6B7280]">
                {PRICING.monthly.cadence}
              </span>
            </p>
            <p className="mt-1 text-sm text-[#7C9A92]">
              {trialEligible
                ? trialThenPriceLine(trialDays, PRICING.monthly.price, "month")
                : "Billed monthly, starting today"}
            </p>
            <FeatureList features={PRICING.monthly.features} />
            <div className="mt-6">
              <UpgradeButton
                interval="monthly"
                label={
                  trialEligible ? startTrialCta(trialDays) : "Subscribe — pay today"
                }
                amount={PRICING.monthly.price}
                cadence={PRICING.monthly.cadence}
                trialEligible={trialEligible}
                trialChargeDate={chargeDate}
                highlight={!emphasizeYearly}
              />
            </div>
          </div>

          {/* Yearly */}
          <div
            className={
              emphasizeYearly
                ? "rounded-2xl border-2 border-[#7C9A92] bg-white p-6 shadow-sm"
                : "rounded-2xl bg-white p-6 shadow-sm"
            }
          >
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-[#1F2937]">{PRICING.yearly.name}</h2>
              <span className="rounded-full bg-[#DCFCE7] px-2.5 py-0.5 text-xs font-medium text-[#166534]">
                {PRICING.yearly.note}
              </span>
            </div>
            <p className="mt-1 text-3xl font-semibold text-[#1F2937]">
              {PRICING.yearly.price}
              <span className="text-base font-normal text-[#6B7280]">
                {PRICING.yearly.cadence}
              </span>
            </p>
            <p className="mt-1 text-sm text-[#7C9A92]">
              {trialEligible
                ? `About €5.00/month • ${trialThenPriceLine(
                    trialDays,
                    PRICING.yearly.price,
                    "year"
                  )}`
                : "About €5.00/month • Billed yearly, starting today"}
            </p>
            <p className="mt-1 text-xs text-[#6B7280]">
              €59.99/year instead of €119.88 (12 × €9.99) — you save €59.89.
            </p>
            <FeatureList features={PRICING.yearly.features} />
            <div className="mt-6">
              <UpgradeButton
                interval="yearly"
                label={
                  trialEligible ? startTrialCta(trialDays) : "Subscribe — pay today"
                }
                amount={PRICING.yearly.price}
                cadence={PRICING.yearly.cadence}
                trialEligible={trialEligible}
                trialChargeDate={chargeDate}
                highlight={emphasizeYearly}
              />
            </div>
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-[#9CA3AF]">
          {trialEligible
            ? "Payment method required. You'll see your exact charge date before checkout. Your subscription renews automatically unless you cancel before the trial ends."
            : "Your subscription renews automatically. Cancel anytime from your billing settings."}{" "}
          Mellowa is not medical care, therapy or emergency support.
        </p>
      </main>
    </div>
  );
}
