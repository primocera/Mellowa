import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { PRICING } from "@/lib/stripe/plans";
import { UpgradeButton } from "@/components/dailyflow/upgrade-button";

export const metadata: Metadata = { title: "Pricing — Mellowa" };

function FeatureList({ features }: { features: readonly string[] }) {
  return (
    <ul className="mt-4 space-y-2">
      {features.map((f) => (
        <li key={f} className="flex items-start gap-2 text-sm text-[#1F2937]">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#7C9A92]" />
          {f}
        </li>
      ))}
    </ul>
  );
}

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[#FAF7F2] px-6 py-12">
      <div className="mx-auto max-w-3xl">
        <div className="text-center">
          <Link href="/" className="text-lg font-semibold tracking-tight text-[#1F2937]">
            Mellowa
          </Link>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight text-[#1F2937]">
            Start with 3 days free
          </h1>
          <p className="mt-2 text-[#6B7280]">
            Both plans unlock everything. Cancel anytime before your trial ends.
          </p>
        </div>

        <div className="mx-auto mt-10 grid max-w-2xl gap-4 md:grid-cols-2">
          {/* Monthly */}
          <div className="rounded-2xl border-2 border-[#7C9A92] bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-[#1F2937]">{PRICING.monthly.name}</h2>
              <span className="rounded-full bg-[#7C9A92]/10 px-2.5 py-0.5 text-xs font-medium text-[#6D8C7D]">
                Popular
              </span>
            </div>
            <p className="mt-1 text-3xl font-semibold text-[#1F2937]">
              {PRICING.monthly.price}
              <span className="text-base font-normal text-[#6B7280]">
                {PRICING.monthly.cadence}
              </span>
            </p>
            <p className="mt-1 text-sm text-[#7C9A92]">3 days free, then billed monthly</p>
            <FeatureList features={PRICING.monthly.features} />
            <div className="mt-6">
              <UpgradeButton
                interval="monthly"
                label="Start 3-day free trial"
                amount={PRICING.monthly.price}
                cadence={PRICING.monthly.cadence}
                highlight
              />
            </div>
          </div>

          {/* Yearly */}
          <div className="rounded-2xl bg-white p-6 shadow-sm">
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
            <p className="mt-1 text-sm text-[#7C9A92]">3 days free, then billed yearly</p>
            <FeatureList features={PRICING.yearly.features} />
            <div className="mt-6">
              <UpgradeButton
                interval="yearly"
                label="Start 3-day free trial"
                amount={PRICING.yearly.price}
                cadence={PRICING.yearly.cadence}
              />
            </div>
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-[#9CA3AF]">
          Cancel anytime before your trial ends. Mellowa is not medical care,
          therapy or emergency support.
        </p>
      </div>
    </div>
  );
}
