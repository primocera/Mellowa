import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { readLegalConfig } from "@/lib/legal/config";
import { TERMS } from "@/lib/content/terminology";

export const metadata: Metadata = {
  title: "Mellowa — A realistic plan for the day you actually have",
  description:
    "Tell Mellowa how much energy and time you have. It shapes a doable plan for meals, movement, focus and a calmer end to the day — without calorie targets, streaks or pressure.",
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
    a: "One personalized day plan after a short setup. No payment method is required for the sample.",
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
];

export default function LandingPage() {
  const legal = readLegalConfig();
  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#1F2937]">
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
          A realistic plan for the day you actually have.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-[#6B7280]">
          Tell Mellowa how much energy and time you have. It shapes a doable
          plan for meals, movement, focus and a calmer end to the day — without
          calorie targets, streaks or pressure.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/signup"
            className="rounded-xl bg-[#7C9A92] px-6 py-3.5 font-medium text-white transition hover:bg-[#6D8C7D]"
          >
            {TERMS.sampleCta}
          </Link>
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
          <span>About one minute to check in</span>
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
            A short check-in gives Mellowa the context it needs: your available
            energy, time, schedule and preferences. The result is smaller on
            difficult days and more complete when you have room.
          </p>
        </div>
      </section>

      {/* 4. Sample plan preview */}
      <section id="sample-plan" className="mx-auto max-w-3xl px-6 py-12">
        <div className="mx-auto max-w-md rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="font-medium text-[#1F2937]">Today&rsquo;s shape</h2>
          <ul className="mt-4 space-y-3">
            {[
              "Three easy meals that fit your cooking time",
              "One movement option — only if it feels useful",
              "One short reset for the busiest part of the day",
              "A simpler evening landing",
            ].map((line) => (
              <li key={line} className="flex items-start gap-3">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#7C9A92]" />
                <span className="text-sm text-[#374151]">{line}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-3 text-center text-sm text-[#9CA3AF]">
          A sample of the structure — not a promise that every day needs every
          part.
        </p>
      </section>

      {/* 5. How it works */}
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

      {/* 6. Difference */}
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

      {/* 7. Offer */}
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
          <Link
            href="/signup?plan=monthly"
            className="block w-64 rounded-2xl bg-white p-6 text-left shadow-sm transition hover:shadow-md hover:ring-2 hover:ring-[#7C9A92]/40"
          >
            <h3 className="font-medium">Mellowa Monthly</h3>
            <p className="mt-1 text-2xl font-semibold">
              €9.99<span className="text-base font-normal text-[#6B7280]">/mo</span>
            </p>
            <p className="mt-1 text-sm text-[#6B7280]">3 days free, then monthly.</p>
            <span className="mt-4 inline-block rounded-xl bg-[#7C9A92] px-4 py-2 text-sm font-medium text-white">
              Start with a free sample
            </span>
          </Link>
          <Link
            href="/signup?plan=yearly"
            className="block w-64 rounded-2xl border-2 border-[#7C9A92] bg-white p-6 text-left shadow-sm transition hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-medium">Mellowa Yearly</h3>
              <span className="rounded-full bg-[#7C9A92]/10 px-2.5 py-0.5 text-xs font-medium text-[#6D8C7D]">
                Save 50%
              </span>
            </div>
            <p className="mt-1 text-2xl font-semibold">
              €59.99<span className="text-base font-normal text-[#6B7280]">/yr</span>
            </p>
            <p className="mt-1 text-sm text-[#6B7280]">
              About €5.00/month. 3 days free.
            </p>
            <span className="mt-4 inline-block rounded-xl bg-[#7C9A92] px-4 py-2 text-sm font-medium text-white">
              Start with a free sample
            </span>
          </Link>
        </div>
        <Link
          href="/pricing"
          className="mt-6 inline-block text-sm font-medium text-[#7C9A92] hover:underline"
        >
          See what&apos;s included →
        </Link>
      </section>

      {/* 8. FAQ */}
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

      {/* 9. Final CTA */}
      <section className="mx-auto max-w-3xl px-6 pb-20 pt-8 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">
          Give today a clearer shape.
        </h2>
        <p className="mt-2 text-[#6B7280]">
          One check-in. One realistic plan. Room for real life.
        </p>
        <Link
          href="/signup"
          className="mt-6 inline-block rounded-xl bg-[#7C9A92] px-6 py-3.5 font-medium text-white transition hover:bg-[#6D8C7D]"
        >
          {TERMS.sampleCta}
        </Link>
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
