import Link from "next/link";
import { AlertCircle, Info } from "lucide-react";
import { getUserSubscriptionStatus } from "@/lib/stripe/subscription";
import { recoveryNoticeFor } from "@/lib/stripe/recovery";

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

/**
 * MW-V10-03: the single recovery route for past_due / unpaid / canceled / not
 * renewing. Renders nothing for a healthy subscription, so it never competes
 * with the trial banner or with Now.
 *
 * Server component: the state comes from the canonical subscription helper, so
 * the client cannot influence what is shown.
 */
export async function BillingRecoveryBanner({ userId }: { userId: string }) {
  const sub = await getUserSubscriptionStatus(userId);
  const notice = recoveryNoticeFor({
    status: sub.status,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    periodEndLabel: formatDate(
      sub.status === "trialing" ? sub.trialEndsAt : sub.currentPeriodEnd
    ),
  });
  if (!notice) return null;

  const attention = notice.tone === "attention";

  return (
    <div
      role="status"
      className={
        attention
          ? "mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-[#FEE2E2] px-4 py-3"
          : "mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-[#EEF2FF] px-4 py-3"
      }
    >
      <div className="flex items-start gap-2 text-sm text-[#1F2937]">
        {attention ? (
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#991B1B]" />
        ) : (
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#7C9A92]" />
        )}
        <span>
          {/* What still works comes first, deliberately. */}
          {notice.kept} {notice.action}
        </span>
      </div>
      <Link
        href={notice.href}
        className="shrink-0 text-sm font-medium text-[#7C9A92] underline underline-offset-2 hover:text-[#6D8C7D]"
      >
        {notice.cta} →
      </Link>
    </div>
  );
}
