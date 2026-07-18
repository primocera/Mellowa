import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal/legal-page";
import { readLegalConfig } from "@/lib/legal/config";
import { POLICY_VERSIONS } from "@/lib/consent/config";

export const metadata: Metadata = {
  title: "Privacy Policy — Mellowa",
  description: "How Mellowa collects, uses and protects your data.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  const legal = readLegalConfig();
  return (
    <LegalPage
      title="Privacy Policy"
      lastUpdated="July 2026"
      version={POLICY_VERSIONS.privacy}
    >
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

      <LegalSection heading="Service providers">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Anthropic</strong> — AI plan generation (profile and check-in excerpts per request; not used to train third-party models).</li>
          <li><strong>Stripe</strong> — subscription payments (we never see your full card number).</li>
          <li><strong>Resend</strong> — transactional email (your email address and message content only; never your wellbeing entries).</li>
          <li><strong>Supabase</strong> — database and authentication.</li>
          <li><strong>Vercel</strong> — hosting.</li>
        </ul>
        <p className="mt-2">
          These providers may process data outside your country; where they do,
          transfers rely on their standard contractual safeguards.
        </p>
      </LegalSection>

      <LegalSection heading="Retention">
        <ul className="list-disc space-y-1 pl-5">
          <li>Your profile, check-ins, plans, journal and habits: kept until you delete them or your account.</li>
          <li>Safety-event excerpts (short, redacted): up to 180 days, for safety-system quality only.</li>
          <li>Product analytics events: up to 12 months.</li>
          <li>Undelivered email records: up to 90 days.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="Your rights">
        <p>
          You can export a full machine-readable copy of your data, correct it,
          or delete your account at any time from Settings, or by contacting us.
          Deleting your account cancels any active subscription and removes every
          record linked to you — profile, check-ins, plans, meals, journal,
          habits, feedback and analytics links.
        </p>
      </LegalSection>

      <LegalSection heading="Contact">
        <p>
          Questions about privacy? Email{" "}
          <a href={`mailto:${legal.privacyEmail}`} className="text-[#6D8C7D] underline">
            {legal.privacyEmail}
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
