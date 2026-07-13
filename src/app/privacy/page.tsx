import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy — Mellowa",
  description: "How Mellowa collects, uses and protects your data.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" lastUpdated="July 2026">
      <p>
        Mellowa (&ldquo;we&rdquo;, &ldquo;us&rdquo;) is a consumer wellness app
        that helps you create gentle daily routines for food, energy, mood and
        habits. This policy explains what we collect and why. Mellowa is not a
        medical, therapy or emergency service.
      </p>

      <LegalSection heading="What we collect">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Account data:</strong> your email address, used for login and
            essential service messages.
          </li>
          <li>
            <strong>Wellbeing profile &amp; check-ins:</strong> the preferences,
            energy/mood/stress inputs and notes you enter to generate your plans.
          </li>
          <li>
            <strong>Generated plans:</strong> the daily and weekly routines,
            meal ideas and habits created for you.
          </li>
          <li>
            <strong>Billing data:</strong> subscription status and identifiers
            from Stripe. We never see or store your full card number.
          </li>
          <li>
            <strong>Usage events:</strong> minimal metering (which generation you
            ran and when) to prevent abuse and keep the service reliable.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="How we use your data">
        <p>
          We use your data to create your personalized routines, keep your
          account working, process your subscription, and protect the service
          from misuse. We do not sell your personal data.
        </p>
      </LegalSection>

      <LegalSection heading="AI processing">
        <p>
          To generate plans, the relevant parts of your profile and check-in are
          sent to our AI provider (Anthropic) as part of the request. Every
          request first passes a safety classification. We do not use your entries
          to train third-party models.
        </p>
      </LegalSection>

      <LegalSection heading="Storage &amp; security">
        <p>
          Your data is stored with our infrastructure providers (Supabase for the
          database and authentication, Vercel for hosting). Access to your rows is
          protected by row-level security so only you can read your own data.
        </p>
      </LegalSection>

      <LegalSection heading="Your rights">
        <p>
          You can access, correct or delete your data at any time from your
          settings, or by contacting us. Deleting your account removes your
          profile, check-ins and generated plans.
        </p>
      </LegalSection>

      <LegalSection heading="Contact">
        <p>
          Questions about privacy? Email{" "}
          <a href="mailto:support@mellowa.app" className="text-[#6D8C7D] underline">
            support@mellowa.app
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
