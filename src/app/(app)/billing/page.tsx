import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/get-current-user";
import { getUserSubscriptionStatus } from "@/lib/stripe/subscription";
import { PRICING } from "@/lib/stripe/plans";
import { UpgradeButton } from "@/components/dailyflow/upgrade-button";
import { ManageBilling } from "@/components/dailyflow/manage-billing";
import { readLegalConfig } from "@/lib/legal/config";

export const metadata: Metadata = { title: "Billing — Mellowa" };

function formatDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString() : null;
}

export default async function BillingPage() {
  const user = await requireUser();
  const sub = await getUserSubscriptionStatus(user.id);

  const isTrialing = sub.status === "trialing";
  const isActive = sub.status === "active";
  const isPastDue = sub.status === "past_due";

  const isYearly = sub.planName === "pro_yearly";
  const planLabel = isYearly ? PRICING.yearly.name : PRICING.monthly.name;
  const priceLabel = isYearly
    ? `${PRICING.yearly.price}${PRICING.yearly.cadence}`
    : `${PRICING.monthly.price}${PRICING.monthly.cadence}`;

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-[#1F2937]">
        Billing
      </h1>

      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="font-medium text-[#1F2937]">Your plan</h2>

        {sub.isPremium ? (
          <>
            <p className="mt-2 inline-block rounded-full bg-[#DCFCE7] px-3 py-1 text-sm font-medium text-[#166534]">
              {isTrialing ? "Trial active" : "Mellowa Premium"}
            </p>

            {isTrialing && sub.trialEndsAt && (
              <p className="mt-2 text-sm text-[#6B7280]">
                Your trial ends on {formatDate(sub.trialEndsAt)}
                {typeof sub.daysLeftInTrial === "number" &&
                  ` (${sub.daysLeftInTrial} ${
                    sub.daysLeftInTrial === 1 ? "day" : "days"
                  } left)`}
                . You&rsquo;ll be charged {priceLabel} for {planLabel} on that
                date unless you cancel before then.
              </p>
            )}

            {isActive && sub.currentPeriodEnd && (
              <p className="mt-2 text-sm text-[#6B7280]">
                {planLabel} renews for {priceLabel} on{" "}
                {formatDate(sub.currentPeriodEnd)}.
              </p>
            )}

            <p className="mt-3 text-sm text-[#6B7280]">
              Full access: daily plans, weekly structure, meal rhythm, journal
              reflections and patterns.
            </p>

            <ManageBilling
              cancelAtPeriodEnd={sub.cancelAtPeriodEnd}
              periodEndLabel={formatDate(
                isTrialing ? sub.trialEndsAt : sub.currentPeriodEnd
              )}
              canCancel
            />
          </>
        ) : (
          <>
            <p
              className={
                isPastDue
                  ? "mt-2 inline-block rounded-full bg-[#FEE2E2] px-3 py-1 text-sm font-medium text-[#991B1B]"
                  : "mt-2 inline-block rounded-full bg-[#FAF7F2] px-3 py-1 text-sm font-medium text-[#6B7280]"
              }
            >
              {isPastDue ? "Payment needs attention" : "No active plan"}
            </p>
            {isPastDue ? (
              <>
                <p className="mt-3 text-sm text-[#6B7280]">
                  We couldn&rsquo;t process the latest payment. Your saved plans
                  remain available; update your payment method to create new
                  Premium plans.
                </p>
                <ManageBilling
                  cancelAtPeriodEnd={sub.cancelAtPeriodEnd}
                  periodEndLabel={formatDate(sub.currentPeriodEnd)}
                  canCancel
                />
              </>
            ) : (
              <>
                <p className="mt-3 text-sm text-[#6B7280]">
                  Start 3 days free to create new daily plans, shape the week
                  and use reflections — personalized plans come with fair-use
                  safeguards.
                </p>
                <div className="mt-4 space-y-2">
                  <UpgradeButton
                    interval="monthly"
                    label="Start 3 days free — €9.99/mo"
                    amount="€9.99"
                    cadence="/month"
                    highlight
                  />
                  <UpgradeButton
                    interval="yearly"
                    label="Start 3 days free — €59.99/yr"
                    amount="€59.99"
                    cadence="/year"
                  />
                </div>
                <p className="mt-3 text-xs text-[#9CA3AF]">
                  Payment method required. You&rsquo;ll see your exact charge
                  date before checkout. Cancel anytime before your trial ends.
                </p>
              </>
            )}
          </>
        )}
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="font-medium text-[#1F2937]">Refunds</h2>
        <p className="mt-2 text-sm text-[#6B7280]">
          If a charge doesn&rsquo;t feel right, tell us — we review every
          request personally, usually within 3 business days. Our{" "}
          <Link href="/refund" className="text-[#7C9A92] hover:underline">
            refund policy
          </Link>{" "}
          explains what&rsquo;s covered; statutory rights always apply.
        </p>
        <a
          href={`mailto:${readLegalConfig().supportEmail}?subject=${encodeURIComponent("Refund request")}`}
          className="mt-3 inline-block rounded-xl border border-[#E5E1DA] bg-white px-4 py-2 text-sm font-medium text-[#1F2937] transition hover:border-[#7C9A92]/50"
        >
          Request a refund
        </a>
      </div>

      <p className="px-2 text-xs text-[#9CA3AF]">
        Questions about billing? See{" "}
        <Link href="/pricing" className="text-[#7C9A92] hover:underline">
          pricing
        </Link>{" "}
        for what Premium includes. Mellowa is not medical care, therapy or
        emergency support.
      </p>
    </div>
  );
}
