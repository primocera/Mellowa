import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { readLegalConfig } from "@/lib/legal/config";
import { PRICING } from "@/lib/stripe/plans";
import { TERMS, joinSentences } from "@/lib/content/terminology";
import {
  publicTrialDays,
  trialOfferSentence,
  trialThenPriceLine,
} from "@/lib/stripe/trial-experiment";
import { TrackedCta } from "@/components/dailyflow/tracked-cta";
import { LandingHeader } from "@/components/dailyflow/landing-header";
import { AdaptiveDayProof } from "@/components/dailyflow/adaptive-day-proof";
import { SITE_URL } from "@/lib/seo/site";

export const metadata: Metadata = {
  title: "Mellowa — Reshape what's left when your day changes",
  description:
    "A general wellbeing plan for the day you actually have. Check in, get one next step, and adjust what's left when the day changes — completed items stay put and Undo is free. No calorie targets, no streaks, nothing to catch up on. Not medical care.",
  alternates: { canonical: "/" },
};

/**
 * The exact categories every daily plan contains — mirrors the plan schema.
 *
 * MW-V11-03 briefly removed this as a duplicate of the items the adaptation
 * proof shows concretely, which cut the copy further. That was wrong:
 * `landing-conversion.test.ts` pins it as a contract, because enumerating what
 * a plan actually produces is a completeness statement a prospective buyer is
 * entitled to, not marketing padding. An example day proves the format exists;
 * only the list proves nothing has quietly been dropped from it. Restored, and
 * the word-count target missed instead.
 */
const PLAN_CATEGORIES = [
  "A flexible meal rhythm",
  "Hydration cues",
  "Optional movement",
  "One calm reset",
  "An evening wind-down",
  "One small habit with a minimum version",
];

// Premium framed as the three ongoing jobs it actually does — each names only
// implemented capabilities, with no outcome or open-ended-volume claims.
const PREMIUM_JOBS = [
  {
    // MW-V11-03: the "completed items stay put, Undo is free" half of this is
    // now demonstrated in the proof above, so it is not claimed again here.
    title: "Adapt today",
    text: "Create plans day to day, and adjust any day in one pass.",
  },
  {
    title: "Reuse what works",
    text: "Save meals, plan leftovers and build shopping drafts, with preference learning you can see, edit and remove.",
  },
  {
    title: "Carry it into next week",
    text: "A weekly reflection carries your own choices forward, so next week starts from what fit — not a blank slate.",
  },
];

// MW-V11-03: the third line ("feedback shapes later plans, and you can remove
// what was learned") moved into the "How it decides" card, where the same fact
// was already being stated. These two are the ones nothing else covers.
const DIFFERENCE = [
  "No calorie targets or food scoring.",
  "No streaks, warnings or ‘starting over’.",
];

const FAQ = [
  {
    q: "What does the free sample include?",
    a: "One personalized day plan after a short setup — a one-time sample per account. No payment method is required for the account, setup or sample.",
  },
  {
    q: "How long does the daily check-in take?",
    a: "The core check-in — energy, stress and available time — takes about a minute. Optional mood, sleep or notes add a little more.",
  },
  {
    q: "When does the trial begin?",
    a: "Only after you choose a paid plan and continue to secure checkout. A payment method is required, and you'll see the exact charge date first.",
  },
  {
    q: "Is Mellowa a diet or calorie-tracking app?",
    a: "No. Mellowa supports a practical meal rhythm without calorie targets, restriction or weight-loss promises. Approximate nutrition details are optional and hidden by default.",
  },
  {
    q: "Is this therapy or medical advice?",
    a: "No. Mellowa is general wellbeing planning — not medical care, therapy or emergency support. Medical, crisis and severe-allergy needs are redirected to qualified help.",
  },
  {
    q: "What happens on a day with almost no energy?",
    a: "You say capacity is low and the plan gets smaller: the easiest food option, one necessary thing, one recovery cue. Everything else can wait.",
  },
  {
    q: "Can Mellowa replace my doctor, dietitian or therapist?",
    a: "No, never. For medical conditions, pregnancy nutrition, injury recovery, eating-disorder support or mental-health treatment, work with a qualified professional — Mellowa points you there when a request needs it.",
  },
];

/** MW-V10-07: 44px footer targets. The header keeps its original v9 layout. */
const FOOTER_LINK =
  "inline-flex min-h-[44px] items-center rounded-lg px-3 transition hover:text-[#6D8C7D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C9A92] focus-visible:ring-offset-2";

export default function LandingPage() {
  const legal = readLegalConfig();
  // MW-V10-02: the landing page has no user, so it names the trial length only
  // while no cohort experiment is running (the default). Once one is, it
  // promises the exact length before checkout rather than guessing an arm.
  const trialDays = publicTrialDays();

  // Structured data — only claims visible on this page (Prompt 23). The
  // SoftwareApplication carries no rating/review (we have none), and the FAQ
  // mirrors the on-page FAQ verbatim.
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: "Mellowa",
        applicationCategory: "HealthApplication",
        operatingSystem: "Web",
        url: SITE_URL,
        description:
          "General wellbeing day plans that reshape what is left when your day changes, keeping completed items and offering Undo — not medical care, therapy or emergency support.",
        offers: [
          {
            "@type": "Offer",
            price: PRICING.monthly.price.replace("€", ""),
            priceCurrency: "EUR",
            name: PRICING.monthly.name,
          },
          {
            "@type": "Offer",
            price: PRICING.yearly.price.replace("€", ""),
            priceCurrency: "EUR",
            name: PRICING.yearly.name,
          },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQ.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      },
    ],
  };

  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#1F2937]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* Nav — see LandingHeader for the accessibility contract it encodes. */}
      <LandingHeader />

      {/* MW-V10-07: the authenticated shell had a <main> landmark; the public
          pages had none, so a screen-reader user arriving on the landing page
          had nothing to skip the navigation to. */}
      <main id="main">
      {/* 1. Hero */}
      <section className="mx-auto max-w-3xl px-6 pb-12 pt-14 text-center sm:pt-20">
        <p className="text-sm font-medium uppercase tracking-wide text-[#6D8C7D]">
          For days that don&rsquo;t follow a routine.
        </p>
        <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          When your day changes, reshape what&rsquo;s left &mdash; without
          starting over.
        </h1>
        {/* MW-V11-01: composed in JS, not by JSX adjacency. Written as an
            expression followed by prose, this rendered with no space at all
            between the two sentences, because JSX drops the whitespace between
            an expression and a text node that spans lines. */}
        <p className="mx-auto mt-5 max-w-2xl text-lg text-[#6B7280]">
          {joinSentences(
            TERMS.promise,
            "Tell Mellowa the energy and time you actually have, and it shapes a general wellbeing plan around it."
          )}
        </p>

        {/* The loop, above the fold: this is the wedge, so it must be the
            first thing a visitor understands — not a mechanism section they
            have to scroll to reach.

            MW-V11-03: three beats, not five. As one five-item row it wrapped
            wherever the viewport happened to break, stranding "Undo is free"
            alone on a second line and reading like an accident. The flow is
            the three beats; the two reassurances about what a change costs you
            are a separate, deliberate subrow. */}
        <ol className="mx-auto mt-7 flex max-w-2xl flex-wrap items-center justify-center gap-2 text-sm text-[#6B7280]">
          {["Check in", "See one next step", "Adjust what's left"].map((beat, index) => (
            <li key={beat} className="flex items-center gap-2">
              {index > 0 && (
                <span aria-hidden className="text-[#C9C3B8]">
                  &rarr;
                </span>
              )}
              <span className="rounded-full bg-white px-3 py-1.5">{beat}</span>
            </li>
          ))}
        </ol>
        <p className="mx-auto mt-2.5 flex max-w-2xl flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-[#9CA3AF]">
          <span>Completed items stay</span>
          <span aria-hidden>·</span>
          <span>Undo is free</span>
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <TrackedCta
            href="/signup"
            event="landing_cta_clicked"
            surface="landing"
            className="rounded-xl bg-[#7C9A92] px-6 py-3.5 font-medium text-white transition hover:bg-[#6D8C7D]"
          >
            {TERMS.sampleCta}
          </TrackedCta>
          <a
            href="#how-it-works"
            className="rounded-xl border border-[#E5E1DA] bg-white px-6 py-3.5 font-medium text-[#1F2937] transition hover:border-[#7C9A92]/50"
          >
            See how it adapts
          </a>
        </div>
        {/* One statement of the sample terms, not three overlapping ones. */}
        <p className="mt-4 text-sm text-[#9CA3AF]">
          {joinSentences(TERMS.sampleHelper, trialOfferSentence(trialDays))}
        </p>
      </section>

      {/* Trust strip */}
      <section className="mx-auto max-w-3xl px-6 pb-4">
        <p className="mx-auto flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-sm text-[#6B7280]">
          <span>About a minute for the core check-in</span>
          <span aria-hidden>•</span>
          <span>Adjusts to low-capacity days</span>
          <span aria-hidden>•</span>
          <span>General wellbeing, not medical care</span>
        </p>
      </section>

      {/*
        MW-V11-03: the proof of the wedge comes before the description of it.
        This section carries the `how-it-works` anchor because showing the loop
        *is* how it works — the paragraph that used to claim it is gone.
      */}
      <section id="how-it-works" className="mx-auto max-w-3xl px-6 py-12">
        <h2 className="text-center text-2xl font-semibold tracking-tight">
          What happens when your day changes
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-[#6B7280]">
          One pass replaces only what is still open.
        </p>
        <AdaptiveDayProof />

        {/*
          MW-V11-03: three things collapsed into this one section. The green
          "Your day changes. Most plans don't." panel restated the wedge the
          proof demonstrates; the eight-item "One real day" list was a second
          example day; and the "every plan covers…" checklist was the abstract
          version of the very items the proof shows concretely. The one category
          the example did not cover — hydration — is now an item in it, so the
          completeness is demonstrated instead of asserted.
        */}
        <p className="mx-auto mt-8 max-w-xl text-center text-sm text-[#6B7280]">
          Every plan covers the same ground — smaller on hard days, fuller when
          you have room:
        </p>
        <ul className="mx-auto mt-3 grid max-w-xl gap-x-4 gap-y-1.5 text-sm text-[#6B7280] sm:grid-cols-2">
          {PLAN_CATEGORIES.map((category) => (
            <li key={category} className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#7C9A92]" />
              <span>{category}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* 5. Who it's for / how personalization works / what the AI does */}
      <section className="mx-auto max-w-3xl px-6 py-12">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h3 className="font-medium text-[#1F2937]">Who it&rsquo;s for</h3>
            <p className="mt-2 text-sm text-[#6B7280]">
              Full, changeable days that need a realistic rhythm for food,
              movement and winding down — without dieting or tracking.
            </p>
          </div>
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h3 className="font-medium text-[#1F2937]">Who it&rsquo;s not for</h3>
            <p className="mt-2 text-sm text-[#6B7280]">
              It isn&rsquo;t medical care, therapy or crisis support, and
              won&rsquo;t create disease-specific or weight-loss diets. Those
              needs are redirected to qualified help.
            </p>
          </div>
          {/*
            MW-V11-03: "How personalization works" and "What the AI does" were
            two cards answering one question, and the third bullet of the old
            "Fewer decisions" section said the removable-learning part a third
            time. One card, said once.
          */}
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h3 className="font-medium text-[#1F2937]">How it decides</h3>
            <p className="mt-2 text-sm text-[#6B7280]">
              Your check-in — energy, time, schedule, diet preference and
              allergies — shapes each plan, using general wellbeing guidance.
              Every request is safety-checked first, and it never diagnoses
              conditions. Say what didn&rsquo;t fit, or remove anything it
              learned.
            </p>
          </div>
        </div>
        <ul className="mx-auto mt-4 flex max-w-xl flex-wrap justify-center gap-x-4 gap-y-1.5 text-sm text-[#6B7280]">
          {DIFFERENCE.map((line) => (
            <li key={line} className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#7C9A92]" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* 7b. Premium — three ongoing jobs */}
      <section className="mx-auto max-w-5xl px-6 py-12">
        <h2 className="text-center text-2xl font-semibold tracking-tight">
          What Premium keeps doing
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-[#6B7280]">
          The free sample is one day. Premium is the ongoing loop.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {PREMIUM_JOBS.map((job) => (
            <div key={job.title} className="rounded-2xl bg-white p-6 shadow-sm">
              <h3 className="font-medium text-[#1F2937]">{job.title}</h3>
              <p className="mt-1 text-sm text-[#6B7280]">{job.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 8. Offer */}
      <section className="mx-auto max-w-3xl px-6 py-12 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">
          See one day before you choose a plan.
        </h2>
        <p className="mt-2 text-[#6B7280]">
          {joinSentences(
            "Create a free sample day without a card.",
            trialOfferSentence(trialDays)
          )}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-4">
          <TrackedCta
            href="/signup?plan=monthly"
            event="landing_cta_clicked"
            surface="pricing"
            planInterval="monthly"
            className="block w-64 rounded-2xl bg-white p-6 text-left shadow-sm transition hover:shadow-md hover:ring-2 hover:ring-[#7C9A92]/40"
          >
            <h3 className="font-medium">{PRICING.monthly.name}</h3>
            <p className="mt-1 text-2xl font-semibold">
              {PRICING.monthly.price}
              <span className="text-base font-normal text-[#6B7280]">/mo</span>
            </p>
            <p className="mt-1 text-sm text-[#6B7280]">
              {trialThenPriceLine(trialDays, PRICING.monthly.price, "month")}
            </p>
            <span className="mt-4 inline-block rounded-xl bg-[#7C9A92] px-4 py-2 text-sm font-medium text-white">
              Start with a free sample
            </span>
          </TrackedCta>
          <TrackedCta
            href="/signup?plan=yearly"
            event="landing_cta_clicked"
            surface="pricing"
            planInterval="yearly"
            className="block w-64 rounded-2xl border-2 border-[#7C9A92] bg-white p-6 text-left shadow-sm transition hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-medium">{PRICING.yearly.name}</h3>
              <span className="rounded-full bg-[#7C9A92]/10 px-2.5 py-0.5 text-xs font-medium text-[#6D8C7D]">
                Save €59.89
              </span>
            </div>
            <p className="mt-1 text-2xl font-semibold">
              {PRICING.yearly.price}
              <span className="text-base font-normal text-[#6B7280]">/yr</span>
            </p>
            <p className="mt-1 text-sm text-[#6B7280]">
              {/* The explicit arithmetic stays: a "50% saving" a reader cannot
                  check is a marketing claim, and this one is checkable. */}
              {joinSentences(
                `About €5.00/month, billed yearly — ${PRICING.yearly.price} instead of €119.88 (12 × ${PRICING.monthly.price}).`,
                `${trialThenPriceLine(trialDays, PRICING.yearly.price, "year")}.`
              )}
            </p>
            <span className="mt-4 inline-block rounded-xl bg-[#7C9A92] px-4 py-2 text-sm font-medium text-white">
              Start with a free sample
            </span>
          </TrackedCta>
        </div>
        <p className="mx-auto mt-4 max-w-xl text-xs text-[#9CA3AF]">
          A trial only begins when you choose a plan and continue to checkout.
          You&rsquo;ll see the exact charge date first, and it renews
          automatically unless you cancel before the trial ends.
        </p>
        <Link
          href="/pricing"
          className="mt-6 inline-flex min-h-[44px] items-center rounded-lg px-2 text-sm font-medium text-[#7C9A92] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C9A92] focus-visible:ring-offset-2"
        >
          See what&apos;s included →
        </Link>
      </section>

      {/* 9. FAQ */}
      <section className="mx-auto max-w-3xl px-6 py-12">
        <h2 className="text-center text-2xl font-semibold tracking-tight">
          Questions, answered
        </h2>
        <div className="mt-8 space-y-3">
          {FAQ.map((item) => (
            <details key={item.q} className="group rounded-2xl bg-white p-5 shadow-sm">
              <summary className="cursor-pointer list-none font-medium">
                {item.q}
              </summary>
              <p className="mt-2 text-sm text-[#6B7280]">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* 10. Final CTA */}
      <section className="mx-auto max-w-3xl px-6 pb-20 pt-8 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">
          Give today a clearer shape.
        </h2>
        <p className="mt-2 text-[#6B7280]">
          One check-in. One realistic plan. Room for real life.
        </p>
        <TrackedCta
          href="/signup"
          event="landing_cta_clicked"
          surface="landing"
          className="mt-6 inline-block rounded-xl bg-[#7C9A92] px-6 py-3.5 font-medium text-white transition hover:bg-[#6D8C7D]"
        >
          {TERMS.sampleCta}
        </TrackedCta>
      </section>

      </main>

      <footer className="border-t border-[#EDE9E2] py-8 text-center text-xs text-[#9CA3AF]">
        {/* MW-V10-07: legal/support links were 16px tall. These are the links a
            user reaches for when they want to leave or complain — the last place
            to make tapping hard. */}
        <div className="mb-2 flex flex-wrap justify-center gap-1">
          <Link href="/privacy" className={FOOTER_LINK}>
            Privacy
          </Link>
          <Link href="/terms" className={FOOTER_LINK}>
            Terms
          </Link>
          <Link href="/refund" className={FOOTER_LINK}>
            Refunds
          </Link>
          <a href={`mailto:${legal.supportEmail}`} className={FOOTER_LINK}>
            Support
          </a>
        </div>
        © {new Date().getFullYear()} Mellowa. Not medical care, therapy or
        emergency support.
      </footer>
    </div>
  );
}
