import type { Metadata } from "next";
import Link from "next/link";
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
      lastUpdated="October 2026"
      version={POLICY_VERSIONS.privacy}
    >
      <p>
        Mellowa (&ldquo;we&rdquo;, &ldquo;us&rdquo;) is a consumer wellness app
        that helps you create gentle daily routines for food, energy, mood and
        habits. This policy explains what we collect, why, on what legal basis,
        and the rights you have. Mellowa is not a medical, therapy or emergency
        service.
      </p>

      <LegalSection heading="Who is responsible for your data">
        <p>
          The controller of your personal data is{" "}
          {legal.entityName ?? "the operators of Mellowa"}
          {legal.registeredAddress ? `, ${legal.registeredAddress}` : ""}. You can
          reach us about anything in this policy at{" "}
          <a href={`mailto:${legal.privacyEmail}`} className="text-[#6D8C7D] underline">
            {legal.privacyEmail}
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection heading="What we collect">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Account data:</strong> your email address, used for login and
            essential service messages.
          </li>
          <li>
            <strong>Wellbeing information:</strong> the preferences, energy, mood,
            stress, sleep and hunger inputs, allergies, notes and journal entries
            you enter to generate your plans. Some of this can count as
            health-related data, so we only process it with your explicit consent
            (see below).
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
            ran and when) and privacy-safe product events (for example which
            button was tapped) to prevent abuse and keep the service reliable.
            These never contain your wellbeing entries.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Why we use it, and our legal basis">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>To provide Mellowa</strong> (your account, plans, reminders
            you turn on, and your subscription): necessary to perform our
            contract with you (GDPR Art. 6(1)(b)).
          </li>
          <li>
            <strong>To use your wellbeing information</strong> to personalise
            your plans: your explicit consent (GDPR Art. 6(1)(a) and 9(2)(a)),
            which you give with a separate checkbox when you sign up.
          </li>
          <li>
            <strong>To keep billing and tax records:</strong> our legal
            obligations (GDPR Art. 6(1)(c)).
          </li>
          <li>
            <strong>To keep the service secure,</strong> prevent misuse and
            understand which parts of the product work, using minimal,
            non-content events: our legitimate interests (GDPR Art. 6(1)(f)). You
            can object to this at any time.
          </li>
        </ul>
        <p>
          We do not sell your personal data, and we do not use it for
          advertising.
        </p>
      </LegalSection>

      <LegalSection heading="AI processing">
        <p>
          Your plans are written by AI. To generate them, the relevant parts of
          your profile and check-in are sent to our AI provider (Anthropic) as
          part of the request. Every request first passes a safety
          classification. We do not use your entries to train third-party
          models. Plans are suggestions only; Mellowa makes no decisions about
          you that have legal or similarly significant effects.
        </p>
      </LegalSection>

      <LegalSection heading="Cookies and on-device storage">
        <p>
          Mellowa uses no advertising or tracking cookies. We only store what is
          strictly necessary for the service you asked for: login session
          cookies, and on your device a small amount of non-sensitive state such
          as which onboarding step you reached or items you chose to postpone.
          Your wellbeing answers are never stored in your browser. Because this
          storage is strictly necessary, it does not require a cookie banner.
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
          These providers process data on our behalf and only on our
          instructions. Some of them may process data outside the EU/EEA, for
          example in the United States; where they do, transfers rely on the EU
          Standard Contractual Clauses or an adequacy decision such as the
          EU–US Data Privacy Framework.
        </p>
      </LegalSection>

      <LegalSection heading="Retention">
        <ul className="list-disc space-y-1 pl-5">
          <li>Your profile, check-ins, plans, journal and habits: kept until you delete them or your account.</li>
          <li>Safety-event excerpts (short, redacted): up to 180 days, for safety-system quality only.</li>
          <li>Product analytics events: up to 12 months.</li>
          <li>Undelivered email records: up to 90 days.</li>
          <li>Payment and invoice records held by Stripe: as long as tax and accounting law requires.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="Your rights">
        <p>You have the right to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>access your data and receive a copy (export it any time from Settings);</li>
          <li>correct inaccurate data;</li>
          <li>delete your data or your whole account (from Settings);</li>
          <li>restrict or object to processing based on our legitimate interests;</li>
          <li>receive your data in a portable, machine-readable format;</li>
          <li>
            withdraw your consent at any time, as easily as you gave it, by
            deleting your wellbeing data or your account, or by emailing us.
            Withdrawing does not affect processing that happened before, but
            without it Mellowa can no longer create personalised plans.
          </li>
        </ul>
        <p>
          Deleting your account cancels any active subscription and removes every
          record linked to you — profile, check-ins, plans, meals, journal,
          habits, feedback and analytics links — except records we must keep by
          law.
        </p>
        <p>
          If you think we have handled your data wrongly, please tell us first so
          we can put it right. You also have the right to complain to a data
          protection authority — in Slovenia the Information Commissioner
          (Informacijski pooblaščenec,{" "}
          <a
            href="https://www.ip-rs.si"
            className="text-[#6D8C7D] underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            ip-rs.si
          </a>
          ), or the authority in the country where you live.
        </p>
      </LegalSection>

      <LegalSection heading="US residents">
        <p>
          Residents of Washington, Nevada and other US states with consumer
          health data laws can read how these rights apply to them in our{" "}
          <Link href="/health-data" className="text-[#6D8C7D] underline">
            Consumer Health Data Privacy Policy
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection heading="Age">
        <p>
          Mellowa is only for adults aged 18 or over. We do not knowingly collect
          data from anyone younger. If we learn that an account belongs to
          someone under 18, we delete it.
        </p>
      </LegalSection>

      <LegalSection heading="Changes">
        <p>
          When this policy changes materially we update the date and version
          above and ask you to confirm again before your next plan.
        </p>
      </LegalSection>

      <LegalSection heading="Contact">
        <p>
          Questions about privacy, or want to use one of your rights? Email{" "}
          <a href={`mailto:${legal.privacyEmail}`} className="text-[#6D8C7D] underline">
            {legal.privacyEmail}
          </a>
          . We reply within one month.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
