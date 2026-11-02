import type { Metadata } from "next";
import Link from "next/link";
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
      lastUpdated="October 2026"
      version={POLICY_VERSIONS.terms}
    >
      <p>
        By creating a Mellowa account you agree to these terms. Please read them
        together with our Privacy Policy and Refund Policy.
      </p>

      <LegalSection heading="Who we are">
        <p>
          Mellowa is operated by {legal.entityName ?? "the operators of Mellowa"}
          {legal.registeredAddress ? `, ${legal.registeredAddress}` : ""}
          {" "}(&ldquo;we&rdquo;, &ldquo;us&rdquo;). You can reach us at{" "}
          <a href={`mailto:${legal.supportEmail}`} className="text-[#6D8C7D] underline">
            {legal.supportEmail}
          </a>
          .
        </p>
      </LegalSection>

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

      <LegalSection heading="AI-generated suggestions">
        <p>
          Your plans, meal ideas and reflections are written automatically by AI.
          We check them for safety and tone, but AI can still make mistakes or
          suggest something that does not suit you. Treat every suggestion as a
          gentle idea, not an instruction, and skip anything that does not feel
          right for your body or your day.
        </p>
      </LegalSection>

      <LegalSection heading="Food, allergies and movement">
        <p>
          Mellowa tries to leave out the allergens and foods you list, but this
          filtering is automated and cannot be guaranteed. It cannot see product
          labels, recipes&rsquo; exact ingredients or cross-contamination.
          Always check ingredients and labels yourself. If you have a severe or
          life-threatening allergy, Mellowa does not suggest specific meals, and
          you should rely on your doctor or dietitian. Movement suggestions are
          gentle and general; stop if anything hurts and choose what is safe for
          you.
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
          cancellation stops future renewals. If you live in the EU, EEA or UK
          you also have a 14-day right of withdrawal, explained in our{" "}
          <Link href="/refund" className="text-[#6D8C7D] underline">
            Refund &amp; Cancellation Policy
          </Link>
          .
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

      <LegalSection heading="Your content and ours">
        <p>
          What you enter stays yours. You allow us to use it only to run Mellowa
          for you, as described in our Privacy Policy. The plans created for you
          are yours to use personally. The Mellowa app, name, design and texts
          belong to us.
        </p>
      </LegalSection>

      <LegalSection heading="Ending your account">
        <p>
          You can delete your account at any time from Settings; this also
          cancels any subscription. We may suspend or close an account that
          seriously or repeatedly breaks these terms, and will tell you why
          unless the law prevents it. If we close Mellowa as a whole, we will
          give you reasonable notice and refund any unused prepaid period.
        </p>
      </LegalSection>

      <LegalSection heading="Disclaimer &amp; liability">
        <p>
          We work hard to keep Mellowa available and useful, but we cannot
          promise it will always be error-free or uninterrupted. To the extent
          permitted by law, we are not liable for decisions you make based on
          the app&rsquo;s suggestions. Nothing in these terms limits liability
          that cannot be limited by law, such as for intent or gross negligence,
          or your statutory rights as a consumer, including your rights when a
          digital service is faulty.
        </p>
      </LegalSection>

      <LegalSection heading="Governing law and disputes">
        <p>
          These terms are governed by the law of{" "}
          {legal.governingLaw ?? "Slovenia"}. If you are a consumer living
          elsewhere, you keep the protection of the mandatory consumer laws of
          your country and can bring a claim in your local courts. If something
          goes wrong, please contact us first. We will try to resolve it quickly
          and fairly.
        </p>
      </LegalSection>

      <LegalSection heading="Changes">
        <p>
          We may update these terms as the product evolves. We will update the
          date and version above and, for material changes, tell you in advance
          by email or in the app and ask you to confirm again. If you do not
          agree, you can cancel and delete your account.
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
