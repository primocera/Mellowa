import type { Metadata } from "next";
import { OnboardingWizard } from "@/components/dailyflow/onboarding-wizard";

export const metadata: Metadata = { title: "Set the basics — Mellowa" };

export default function OnboardingPage() {
  return (
    <div>
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-[#1F2937]">
          Set the basics once. Keep daily check-ins short.
        </h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          About two minutes. Your answers can be changed anytime.
        </p>
      </div>
      <OnboardingWizard />
    </div>
  );
}
