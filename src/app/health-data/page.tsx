import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/legal/legal-page";
import { readLegalConfig } from "@/lib/legal/config";

export const metadata: Metadata = {
  title: "Consumer Health Data Privacy Policy — Mellowa",
  description:
    "How Mellowa handles consumer health data under Washington's My Health My Data Act and similar US state laws.",
  alternates: { canonical: "/health-data" },
};

/**
 * Washington My Health My Data Act (RCW 19.373) and Nevada SB 370 require a
 * SEPARATE consumer health data privacy policy, linked from the homepage.
 * Mellowa's mood/energy/stress/sleep/allergy inputs can be "consumer health
 * data" under those laws. Keep this page in step with /privacy.
 */
export default function HealthDataPage() {
  const legal = readLegalConfig();
  return (
    <LegalPage title="Consumer Health Data Privacy Policy" lastUpdated="October 2026">
      <p>
        This policy applies to residents of Washington, Nevada and other US
        states whose laws protect consumer health data. It adds to our{" "}
        <Link href="/privacy" className="text-[#6D8C7D] underline">
          Privacy Policy
        </Link>
        .
      </p>

      <LegalSection heading="Health data we collect">
        <p>
          When you use Mellowa you may share information that these laws treat
          as consumer health data: your self-reported energy, mood, stress,
          sleep and hunger levels, food allergies and intolerances, dietary
          preferences, notes and journal entries.
        </p>
      </LegalSection>

      <LegalSection heading="Where it comes from">
        <p>
          Only from you, when you complete your profile, a check-in or a journal
          entry. We do not buy health data or collect it from other sources, and
          we do not infer health conditions.
        </p>
      </LegalSection>

      <LegalSection heading="Why we use it">
        <p>
          Only to create and adjust your personal wellbeing plans and meal ideas,
          to keep allergens out of them, and to run safety checks that stop
          unsafe requests. We collect it only with your consent, which you give
          with a separate checkbox when you sign up.
        </p>
      </LegalSection>

      <LegalSection heading="Who we share it with">
        <p>
          We do not sell consumer health data and never share it for
          advertising. It is processed only by service providers acting on our
          behalf: Anthropic (AI plan generation), Supabase (database) and Vercel
          (hosting). We have no affiliates that receive it.
        </p>
      </LegalSection>

      <LegalSection heading="Your rights">
        <p>
          You can confirm whether we hold your health data, get a copy of it,
          see the list of providers that process it, withdraw your consent, and
          have it deleted. Export and deletion are available any time in
          Settings, or email{" "}
          <a href={`mailto:${legal.privacyEmail}`} className="text-[#6D8C7D] underline">
            {legal.privacyEmail}
          </a>
          . We respond within 45 days. If we decline a request, you can appeal by
          replying to our answer, and if you are still not satisfied you can
          contact your state Attorney General.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
