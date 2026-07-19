import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { readLegalConfig } from "@/lib/legal/config";
import { PRICING } from "@/lib/stripe/plans";
import { TERMS } from "@/lib/content/terminology";
import { TrackedCta } from "@/components/dailyflow/tracked-cta";
import { SITE_URL } from "@/lib/seo/site";

export const metadata: Metadata = {
  title: "Mellowa — A realistic plan for the day you actually have",
  description:
    "Tell Mellowa how much energy and time you have. It shapes a doable plan: a meal rhythm, hydration cues, optional movement, one calm reset, an evening wind-down and one small habit — without calorie targets, streaks or pressure.",
  alternates: { canonical: "/" },
};

const STEPS = [
  {
    step: "1",
    title: "Check in",
    text: "Share your energy, available time and what today looks like. Approximate is enough.",
  },
  {
    step: "2",
    title: "Get today's shape",
    text: "Mellowa creates a realistic structure for food, movement, focus and recovery.",
  },
  {
    step: "3",
    title: "Adjust without starting over",
    text: "Swap a meal, make the day lighter or tell Mellowa what did not fit.",
  },
];

// One concrete, anonymized example day: a meal rhythm, one movement moment
// and one calm reset. Illustrative only — no fabricated data or outcomes.
const SAMPLE_DAY = [
  {
    time: "8:00",
    title: "Breakfast that travels",
    detail: "Overnight oats with fruit and yoghurt — made the night before.",
  },
  {
    time: "10:30",
    title: "Hydration cue",
    detail: "A glass of water with your mid-morning break — before the coffee refill.",
  },
  {
    time: "12:30",
    title: "Lunch, no cooking",
    detail: "A grain bowl from last night's leftovers plus a handful of greens.",
  },
  {
    time: "15:00",
    title: "Movement moment",
    detail: "A 10-minute walk after your busiest meeting — only if it helps.",
  },
  {
    time: "16:30",
    title: "Calm reset",
    detail: "Three slow breaths and a glass of water before the afternoon dip.",
  },
  {
    time: "19:00",
    title: "Dinner in 20 minutes",
    detail: "Sheet-pan chicken and vegetables you can leave in the oven.",
  },
  {
    time: "21:00",
    title: "One small habit",
    detail: "Lay out tomorrow's water bottle — the minimum version is just filling it.",
  },
  {
    time: "21:30",
    title: "Evening wind-down",
    detail: "Screens down, lights low, one page of anything you like.",
  },
];

// The exact categories every daily plan contains — mirrors the plan schema.
const PLAN_CATEGORIES = [
  "A flexible meal rhythm",
  "Hydration cues",
  "Optional movement",
  "One calm reset",
  "An evening wind-down",
  "One small habit with a minimum version",
];

const DIFFERENCE = [
  "The plan changes when your capacity changes.",
  "Meals come without calorie targets or food scoring.",
  "One useful reset replaces a long list of practices.",
  "No streaks, red warnings or ‘starting over’.",
  "Your explicit feedback can shape future plans — and you can remove what was learned.",
];

const FAQ = [
  {
    q: "What does the free sample include?",
    a: "One personalized day plan after a short setup — a one-time sample per account. No payment method is required for the account, the setup or the sample.",
  },
  {
    q: "How long does the daily check-in take?",
    a: "The core check-in — energy, stress and available time — takes about a minute. Optional details like mood, sleep or notes add a little more if you want a more tailored plan.",
  },
  {
    q: "When does the trial begin?",
    a: "Only after you choose a paid plan and continue to secure checkout. A payment method is required, and you'll see the exact charge date before you continue.",
  },
  {
    q: "Is Mellowa a diet or calorie-tracking app?",
    a: "No. Mellowa supports a regular, practical meal rhythm without calorie targets, restriction or weight-loss promises. Approximate nutrition details are optional and hidden by default.",
  },
  {
    q: "Is this therapy or medical advice?",
    a: "No. Mellowa is general wellbeing planning — not medical care, therapy or emergency support. Sensitive medical, crisis and severe-allergy needs are redirected to qualified help.",
  },
  {
    q: "What happens on a day with almost no energy?",
    a: "You tell Mellowa capacity is low and the plan gets smaller: the easiest food option, one necessary thing, one recovery cue. Everything else can wait.",
  },
  {
    q: "Can Mellowa replace my doctor, dietitian or therapist?",
    a: "No. Mellowa never replaces professional care. For medical conditions, pregnancy nutrition, injury recovery, eating-disorder support or mental-health treatment, please work with a qualified professional — Mellowa will point you there when a request needs it.",
  },
];

export default function LandingPage() {
  const legal = readLegalConfig();

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
          "Realistic daily wellbeing plans that adapt to your energy, mood and schedule — not medical care, therapy or emergency support.",
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
      {/* Nav */}
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <span className="text-lg font-semibold tracking-tight">Mellowa</span>
        <nav className="flex items-center gap-3">
          <a
            href="#how-it-works"
            className="hidden text-sm text-[#6B7280] transition hover:text-[#1F2937] sm:inline"
          >
            How it works
          </a>
          <Link href="/pricing" className="text-sm text-[#6B7280] transition hover:text-[#1F2937]">
            Pricing
          </Link>
          <Link href="/login" className="text-sm text-[#6B7280] transition hover:text-[#1F2937]">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-xl bg-[#7C9A92] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#6D8C7D]"
          >
            Create free sample
          </Link>
        </nav>
      </header>

      {/* 1. Hero */}
      <section className="mx-auto max-w-3xl px-6 pb-12 pt-14 text-center sm:pt-20">
        <p className="text-sm font-medium uppercase tracking-wide text-[#6D8C7D]">
          Daily wellbeing, shaped around real life.
        </p>
        <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          {TERMS.promise}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-[#6B7280]">
          Tell Mellowa how much energy and time you have. It shapes a doable
          plan — a meal rhythm, hydration cues, optional movement, one calm
          reset, an evening wind-down and one small habit — without calorie
          targets, streaks or pressure.
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
            href="#sample-plan"
            className="rounded-xl border border-[#E5E1DA] bg-white px-6 py-3.5 font-medium text-[#1F2937] transition hover:border-[#7C9A92]/50"
          >
            See a sample plan
          </a>
        </div>
        <p className="mt-4 text-sm text-[#9CA3AF]">{TERMS.sampleHelper}</p>
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

      {/* 2. Problem */}
      <section className="mx-auto max-w-3xl px-6 py-12 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">
          Your day changes. Most plans don&rsquo;t.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-[#6B7280]">
          Advice is easy to collect. The difficult part is deciding what fits
          between work, meals, low energy and everything that changed after
          breakfast. Mellowa turns that decision into one manageable day.
        </p>
      </section>

      {/* 3. Mechanism */}
      <section className="mx-auto max-w-3xl px-6 py-8">
        <div className="rounded-3xl bg-[#7C9A92] p-8 text-center text-white sm:p-12">
          <h2 className="text-2xl font-semibold tracking-tight">
            Less deciding. One plan that adjusts with you.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-white/85">
            Your planning baseline plus today&rsquo;s energy, stress and time,
            shaped by the plan mode you choose. The result is smaller on
            difficult days and more complete when you have room.
          </p>
          <ul className="mx-auto mt-6 grid max-w-xl gap-2 text-left text-sm text-white/90 sm:grid-cols-2">
            {PLAN_CATEGORIES.map((category) => (
              <li key={category} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-white/70" />
                <span>{category}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 4. Sample plan preview — one concrete, anonymized day */}
      <section id="sample-plan" className="mx-auto max-w-3xl px-6 py-12">
        <h2 className="text-center text-2xl font-semibold tracking-tight">
          One real day, start to finish
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-[#6B7280]">
          An example for a busy weekday with medium energy and about 20 minutes
          to cook. Yours is shaped by your own check-in.
        </p>
        <div className="mx-auto mt-8 max-w-md rounded-2xl bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-[#1F2937]">Wednesday</h3>
            <span className="rounded-full bg-[#7C9A92]/10 px-2.5 py-0.5 text-xs font-medium text-[#6D8C7D]">
              Medium energy · 20-min cooking
            </span>
          </div>
          <ul className="mt-5 space-y-4">
            {SAMPLE_DAY.map((item) => (
              <li key={item.time} className="flex gap-3">
                <span className="w-16 shrink-0 text-xs font-medium uppercase tracking-wide text-[#9CA3AF]">
                  {item.time}
                </span>
                <div>
                  <p className="text-sm font-medium text-[#1F2937]">{item.title}</p>
                  <p className="text-sm text-[#6B7280]">{item.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-3 text-center text-sm text-[#9CA3AF]">
          An illustrative example, not a fixed template — a low-energy day would
          be smaller, and nothing here is a rule you have to follow.
        </p>
      </section>

      {/* 5. Who it's for / how personalization works / what the AI does */}
      <section className="mx-auto max-w-3xl px-6 py-12">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h3 className="font-medium text-[#1F2937]">Who it&rsquo;s for</h3>
            <p className="mt-2 text-sm text-[#6B7280]">
              People with full, changeable days who want a simple, realistic
              rhythm for food, movement, focus and winding down — without
              dieting or tracking everything.
            </p>
          </div>
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h3 className="font-medium text-[#1F2937]">Who it&rsquo;s not for</h3>
            <p className="mt-2 text-sm text-[#6B7280]">
              It isn&rsquo;t medical care, therapy or crisis support, and
              won&rsquo;t create disease-specific or weight-loss diets. Medical,
              crisis and severe-allergy needs are redirected to qualified help.
            </p>
          </div>
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h3 className="font-medium text-[#1F2937]">How personalization works</h3>
            <p className="mt-2 text-sm text-[#6B7280]">
              A short check-in — your energy, time, schedule, diet preference and
              allergies — shapes each plan. You can tell Mellowa what didn&rsquo;t
              fit, and remove anything it learned at any time.
            </p>
          </div>
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <h3 className="font-medium text-[#1F2937]">What the AI does</h3>
            <p className="mt-2 text-sm text-[#6B7280]">
              It turns your check-in into a structured day using general
              wellbeing guidance. Every request is safety-checked first. It
              never diagnoses conditions and isn&rsquo;t a source of medical
              nutrition advice.
            </p>
          </div>
        </div>
      </section>

      {/* 6. How it works */}
      <section id="how-it-works" className="mx-auto max-w-5xl px-6 py-12">
        <h2 className="text-center text-2xl font-semibold tracking-tight">
          From check-in to a clearer day
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {STEPS.map((item) => (
            <div key={item.step} className="rounded-2xl bg-white p-6 shadow-sm">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#7C9A92]/10 text-sm font-semibold text-[#6D8C7D]">
                {item.step}
              </span>
              <h3 className="mt-3 font-medium">{item.title}</h3>
              <p className="mt-1 text-sm text-[#6B7280]">{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 7. Difference */}
      <section className="mx-auto max-w-3xl px-6 py-12">
        <h2 className="text-center text-2xl font-semibold tracking-tight">
          Not more wellness tasks. Fewer decisions.
        </h2>
        <ul className="mx-auto mt-6 max-w-xl space-y-3">
          {DIFFERENCE.map((line) => (
            <li
              key={line}
              className="flex items-start gap-3 rounded-2xl bg-white px-5 py-4 shadow-sm"
            >
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#7C9A92]" />
              <span className="text-sm">{line}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* 8. Offer */}
      <section className="mx-auto max-w-3xl px-6 py-12 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">
          See one day before you choose a plan.
        </h2>
        <p className="mt-2 text-[#6B7280]">
          Create a free sample day without a card. If the structure feels
          useful, Premium starts with a 3-day trial when you choose Monthly or
          Yearly.
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
              {PRICING.monthly.trialDays} days free, then monthly.
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
              About €5.00/month, billed yearly. That&rsquo;s {PRICING.yearly.price}{" "}
              instead of €119.88 (12 × {PRICING.monthly.price}) — a 50% saving.{" "}
              {PRICING.yearly.trialDays} days free.
            </p>
            <span className="mt-4 inline-block rounded-xl bg-[#7C9A92] px-4 py-2 text-sm font-medium text-white">
              Start with a free sample
            </span>
          </TrackedCta>
        </div>
        <p className="mx-auto mt-4 max-w-xl text-xs text-[#9CA3AF]">
          No card for the sample. A trial only begins when you choose a plan and
          continue to checkout — you&rsquo;ll see the exact charge date first,
          and it renews automatically unless you cancel before the trial ends.
        </p>
        <Link
          href="/pricing"
          className="mt-6 inline-block text-sm font-medium text-[#7C9A92] hover:underline"
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

      <footer className="border-t border-[#EDE9E2] py-8 text-center text-xs text-[#9CA3AF]">
        <div className="mb-2 flex flex-wrap justify-center gap-4">
          <Link href="/privacy" className="hover:text-[#6D8C7D]">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-[#6D8C7D]">
            Terms
          </Link>
          <Link href="/refund" className="hover:text-[#6D8C7D]">
            Refunds
          </Link>
          <a href={`mailto:${legal.supportEmail}`} className="hover:text-[#6D8C7D]">
            Support
          </a>
        </div>
        © {new Date().getFullYear()} Mellowa. Not medical care, therapy or
        emergency support.
      </footer>
    </div>
  );
}
