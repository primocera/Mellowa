import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Terms of Service — Mellowa",
  description: "The terms for using Mellowa.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" lastUpdated="July 2026">
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

      <LegalSection heading="Subscriptions &amp; free trial">
        <p>
          Mellowa is offered as a paid subscription (monthly or yearly) with a
          3-day free trial. Your chosen plan begins billing automatically when the
          trial ends unless you cancel beforehand. You can cancel any time from
          your billing settings; cancellation stops future renewals.
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
          <a href="mailto:support@mellowa.app" className="text-[#6D8C7D] underline">
            support@mellowa.app
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
