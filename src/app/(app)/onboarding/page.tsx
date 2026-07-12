import type { Metadata } from "next";
import { OnboardingWizard } from "@/components/dailyflow/onboarding-wizard";

export const metadata: Metadata = { title: "Get started — DailyFlow" };

export default function OnboardingPage() {
  return (
    <div>
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-[#1F2937]">
          Let&apos;s set up your DailyFlow
        </h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          A few short questions so your plans actually fit your life.
        </p>
      </div>
      <OnboardingWizard />
    </div>
  );
}
