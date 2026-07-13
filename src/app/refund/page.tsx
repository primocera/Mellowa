import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Refund & Cancellation Policy — Mellowa",
  description: "How refunds and cancellations work at Mellowa.",
};

export default function RefundPage() {
  return (
    <LegalPage title="Refund & Cancellation Policy" lastUpdated="July 2026">
      <p>
        We want Mellowa to genuinely help. This policy explains how the free
        trial, cancellations and refunds work.
      </p>

      <LegalSection heading="3-day free trial">
        <p>
          Every new subscription starts with a 3-day free trial. You will not be
          charged during the trial. If you cancel before the trial ends, you pay
          nothing.
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
          <a href="mailto:support@mellowa.app" className="text-[#6D8C7D] underline">
            support@mellowa.app
          </a>{" "}
          with the email on your account. We aim to reply within a few business
          days.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
