import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal/legal-page";
import { readLegalConfig } from "@/lib/legal/config";
import {
  publicTrialDays,
  trialLengthAdjective,
  trialLengthLabel,
} from "@/lib/stripe/trial-experiment";

export const metadata: Metadata = {
  title: "Refund & Cancellation Policy — Mellowa",
  description: "How refunds and cancellations work at Mellowa.",
  alternates: { canonical: "/refund" },
};

export default function RefundPage() {
  const legal = readLegalConfig();
  // MW-V10-02: see terms/page.tsx — the length is named only while it is the
  // same for everyone. The refund policy itself does not change.
  const trialDays = publicTrialDays();
  return (
    <LegalPage title="Refund & Cancellation Policy" lastUpdated="July 2026">
      <p>
        We want Mellowa to genuinely help. This policy explains how the free
        trial, cancellations and refunds work.
      </p>

      <LegalSection
        heading={
          trialDays === null
            ? "Free sample and free trial"
            : // Attributive position, so the adjective form is required here.
              `Free sample and ${trialLengthAdjective(trialDays)} trial`
        }
      >
        <p>
          One free sample day plan is available without a payment method. Every
          new subscription then starts with a free trial
          {trialDays === null
            ? " whose exact length and charge date are shown before checkout"
            : ` of ${trialLengthLabel(trialDays)}`}{" "}
          when you choose a plan at checkout. You will not be charged during the
          trial. If you cancel before the trial ends, you pay nothing.
        </p>
      </LegalSection>

      <LegalSection heading="Cancelling">
        <p>
          You can cancel any time from your billing settings. Cancellation stops
          the next renewal; you keep access until the end of the period you have
          already paid for.
        </p>
      </LegalSection>

      <LegalSection heading="Refunds">
        <p>
          Because a free trial lets you evaluate Mellowa before paying,
          subscription payments are generally non-refundable once a billing period
          has started. If you were charged in error, or something clearly went
          wrong, contact us within 14 days and we will review your case fairly.
        </p>
        <p>
          Where required by applicable consumer law (for example a statutory
          withdrawal right), those rights always apply in addition to this policy.
        </p>
      </LegalSection>

      <LegalSection heading="How to request">
        <p>
          Email{" "}
          <a href={`mailto:${legal.supportEmail}`} className="text-[#6D8C7D] underline">
            {legal.supportEmail}
          </a>{" "}
          with the email on your account. We aim to reply within a few business
          days.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
