import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal/legal-page";
import { readLegalConfig } from "@/lib/legal/config";
import { POLICY_VERSIONS } from "@/lib/consent/config";
import {
  publicTrialDays,
  trialLengthLabel,
} from "@/lib/stripe/trial-experiment";

export const metadata: Metadata = {
  title: "Terms of Service — Mellowa",
  description: "The terms for using Mellowa.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  const legal = readLegalConfig();
  // MW-V10-02: the trial length is named here only while it is the same for
  // everyone. Once a cohort experiment is running the terms state that the
  // exact length is disclosed at checkout — which it is, on every surface.
  // The policy itself is unchanged either way.
  const trialDays = publicTrialDays();
  return (
    <LegalPage
      title="Terms of Service"
      lastUpdated="July 2026"
      version={POLICY_VERSIONS.terms}
    >
      <p>
        By creating a Mellowa account you agree to these terms. Please read them
        together with our Privacy Policy and Refund Policy.
      </p>

      <LegalSection heading="What Mellowa is (and is not)">
        <p>
          Mellowa is a general wellbeing and daily-routine app. It is{" "}
          <strong>not</strong> medical care, therapy, an eating-disorder recovery
          tool, or an emergency service. Its suggestions are general and for
          informational purposes only. Always use your own judgement and consult a
          qualified professional for medical, nutritional or mental-health advice.
          If you are in crisis, contact your local emergency services.
        </p>
      </LegalSection>

      <LegalSection heading="Your account">
        <p>
          You are responsible for keeping your login secure and for the accuracy
          of the information you provide. You must be at least 18 years old to use
          Mellowa.
        </p>
      </LegalSection>

      <LegalSection heading="Free sample, subscriptions &amp; trial">
        <p>
          New accounts can create one free sample day plan without a payment
          method. Mellowa is otherwise offered as a paid subscription (monthly
          or yearly) with a free trial
          {trialDays === null
            ? " whose exact length and charge date are shown to you before checkout"
            : ` of ${trialLengthLabel(trialDays)}`}{" "}
          that starts only when you choose a plan and add a payment method at
          checkout. Your chosen plan begins billing automatically when the trial
          ends unless you cancel beforehand. You can cancel any time from your billing settings;
          cancellation stops future renewals.
        </p>
      </LegalSection>

      <LegalSection heading="Acceptable use">
        <p>
          Please use Mellowa as intended. Do not attempt to abuse, overload or
          reverse-engineer the service, or use it to generate harmful content. We
          apply reasonable rate limits to protect the service, and may suspend
          accounts that violate these terms.
        </p>
      </LegalSection>

      <LegalSection heading="Disclaimer &amp; liability">
        <p>
          Mellowa is provided &ldquo;as is&rdquo; without warranties. To the extent
          permitted by law, we are not liable for any decisions you make based on
          the app&rsquo;s suggestions. You use Mellowa at your own discretion.
        </p>
      </LegalSection>

      <LegalSection heading="Changes">
        <p>
          We may update these terms as the product evolves. We will update the
          &ldquo;last updated&rdquo; date above and, for material changes, notify
          you by email.
        </p>
      </LegalSection>

      <LegalSection heading="Contact">
        <p>
          Questions? Email{" "}
          <a href={`mailto:${legal.supportEmail}`} className="text-[#6D8C7D] underline">
            {legal.supportEmail}
          </a>
          . This inbox is not monitored for emergencies.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
