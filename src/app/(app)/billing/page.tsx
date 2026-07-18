import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/get-current-user";
import { getUserSubscriptionStatus } from "@/lib/stripe/subscription";
import { UpgradeButton } from "@/components/dailyflow/upgrade-button";
import { ManageBilling } from "@/components/dailyflow/manage-billing";

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
              {isTrialing ? "Free trial active" : "Mellowa Premium"}
            </p>

            {isTrialing && sub.trialEndsAt && (
              <p className="mt-2 text-sm text-[#6B7280]">
                Your trial ends on {formatDate(sub.trialEndsAt)}
                {typeof sub.daysLeftInTrial === "number" &&
                  ` (${sub.daysLeftInTrial} ${
                    sub.daysLeftInTrial === 1 ? "day" : "days"
                  } left)`}
                . You can cancel anytime before then.
              </p>
            )}

            {isActive && sub.currentPeriodEnd && (
              <p className="mt-2 text-sm text-[#6B7280]">
                Renews on {formatDate(sub.currentPeriodEnd)}.
              </p>
            )}

            {sub.planName && (
              <p className="mt-2 text-sm text-[#6B7280]">
                Plan: {sub.planName === "pro_yearly" ? "Yearly (€59.99/year)" : "Monthly (€9.99/month)"}
              </p>
            )}

            <p className="mt-3 text-sm text-[#6B7280]">
              You have full access to daily plans, weekly reset, meal rhythm,
              journal and progress.
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
              {isPastDue ? "Payment issue" : "No active plan"}
            </p>
            {isPastDue ? (
              <>
                <p className="mt-3 text-sm text-[#6B7280]">
                  There was a problem with your last payment. Update your payment
                  method to restore full access — your saved plans stay readable
                  in the meantime.
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
