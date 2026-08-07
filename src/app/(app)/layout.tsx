import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/get-current-user";
import { AppNav } from "@/components/layout/app-nav";
import { navEntitlement } from "@/lib/nav/entitlement";
import { TrialBanner } from "@/components/dailyflow/trial-banner";
import { BillingRecoveryBanner } from "@/components/dailyflow/billing-recovery-banner";
import { ConsentCheckpoint } from "@/components/dailyflow/consent-checkpoint";
import { getUserSubscriptionStatus } from "@/lib/stripe/subscription";

// Authenticated surfaces must never be indexed (Launch v6, Prompt 23).
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const subscription = await getUserSubscriptionStatus(user.id);

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <AppNav entitlement={navEntitlement(subscription.status, subscription.billing)} />
      <main id="main" className="px-4 pb-24 pt-6 md:ml-56 md:px-8 md:pb-8">
        <div className="mx-auto max-w-3xl">
          <TrialBanner userId={user.id} />
          {/* MW-V10-03: a billing state the user cannot fix by using the app
              gets exactly one route back, on every authenticated surface — not
              only inside a 402 error at the moment they try to generate. Never
              two banners at once: the trial banner stands down when a trial is
              set not to renew, and this notice returns null for a healthy
              trial. */}
          <BillingRecoveryBanner userId={user.id} />
          <ConsentCheckpoint />
          {children}
        </div>
      </main>
    </div>
  );
}
