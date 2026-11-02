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
    <LegalPage title="Refund & Cancellation Policy" lastUpdated="October 2026">
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

      <LegalSection heading="14-day right of withdrawal (EU, EEA and UK)">
        <p>
          If you live in the EU, EEA or UK, you can withdraw from your
          subscription within 14 days of the day you started it (the day you
          chose a plan at checkout, including when it starts with a free trial),
          without giving any reason.
        </p>
        <p>
          To withdraw, tell us clearly before the 14 days end — an email to{" "}
          <a href={`mailto:${legal.supportEmail}`} className="text-[#6D8C7D] underline">
            {legal.supportEmail}
          </a>{" "}
          from the address on your account is enough. You may use the model form
          below, but you do not have to.
        </p>
        <p>
          If you withdraw, we end your subscription and refund every payment you
          made for it, in full, within 14 days of receiving your message, using
          the same payment method you used. You pay no fee for the refund.
        </p>
      </LegalSection>

      <LegalSection heading="Other refunds">
        <p>
          Outside the 14-day withdrawal period, subscription payments for a
          billing period that has already started are not refunded, because the
          free trial lets you try Mellowa before paying. If you were charged in
          error, or something clearly went wrong, contact us and we will review
          your case fairly. Your statutory rights, including your rights when a
          digital service is faulty, always apply in addition to this policy.
        </p>
      </LegalSection>

      <LegalSection heading="Model withdrawal form">
        <p className="text-sm text-[#6B7280]">
          (Complete and send this form only if you wish to withdraw from the
          contract.)
        </p>
        <div className="rounded-xl bg-white p-4 text-sm">
          <p>
            To: {legal.entityName ?? "Mellowa"}
            {legal.registeredAddress ? `, ${legal.registeredAddress}` : ""},{" "}
            {legal.supportEmail}
          </p>
          <p className="mt-2">
            I hereby give notice that I withdraw from my contract for the
            provision of the following service: Mellowa subscription.
          </p>
          <p className="mt-2">Subscribed on: ____________</p>
          <p>Name: ____________</p>
          <p>Email address of the account: ____________</p>
          <p>Date: ____________</p>
        </div>
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
