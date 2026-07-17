import type { Metadata } from "next";
import Link from "next/link";
import {
  UtensilsCrossed,
  Droplets,
  Footprints,
  Wind,
  Moon,
  Repeat,
  Check,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Mellowa — A gentler daily plan for food, energy and habits",
  description:
    "Mellowa turns your mood, energy and schedule into a realistic plan for meals, hydration, movement, stress resets and calmer evenings — without strict dieting or overwhelm.",
};

const PLAN_INCLUDES = [
  { icon: UtensilsCrossed, label: "Simple meal rhythm", text: "Realistic breakfast, lunch and dinner ideas that match your time and budget." },
  { icon: Droplets, label: "Hydration rhythm", text: "Gentle reminders woven into your day — not another app yelling at you." },
  { icon: Footprints, label: "Movement moments", text: "Ten-minute walks and light movement that fit your actual schedule." },
  { icon: Wind, label: "Stress resets", text: "Small pauses for heavy days: breathing, stepping outside, slowing down." },
  { icon: Moon, label: "Sleep wind-down", text: "A calm evening routine so the day actually ends." },
  { icon: Repeat, label: "One small habit", text: "One doable habit with a minimum version for hard days." },
];

const HOW_IT_WORKS = [
  { step: "1", title: "Check in", text: "One minute: energy, mood, stress, sleep and how much time you have." },
  { step: "2", title: "Get your plan", text: "A realistic day plan that adapts to how today actually feels." },
  { step: "3", title: "Follow one small habit", text: "Not twelve. One — with a minimum version for tough days." },
  { step: "4", title: "Adjust weekly", text: "A weekly structure with meals, a shopping list and a gentle review." },
];

const FAQ = [
  {
    q: "Is Mellowa a diet app?",
    a: "No. Mellowa never counts calories, restricts food or promises weight loss. It helps you build a calm, repeatable meal rhythm that fits your life.",
  },
  {
    q: "Is this therapy or medical advice?",
    a: "No. Mellowa is not medical care, therapy or emergency support. For medical conditions, eating disorder concerns, pregnancy or severe mental health symptoms, please seek qualified professional support.",
  },
  {
    q: "What if I have a low-energy day?",
    a: "That's exactly what Mellowa is built for. Low energy means a simpler plan — easier meals, lighter movement, more recovery. Every plan has a minimum version.",
  },
  {
    q: "How long does the daily check-in take?",
    a: "About a minute. Four quick sliders and an optional note — then your plan is ready.",
  },
  {
    q: "What does the free sample include?",
    a: "One personalized day plan after a short setup. No payment method is required for the sample.",
  },
  {
    q: "When does the 3-day trial begin?",
    a: "Only after you choose Monthly or Yearly and continue to secure checkout. A payment method is required, and you'll see the exact charge date before you continue. After the trial, your plan continues at €9.99/month or €59.99/year unless you cancel first.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#1F2937]">
      {/* Nav */}
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <span className="text-lg font-semibold tracking-tight">Mellowa</span>
        <nav className="flex items-center gap-3">
          <Link href="/pricing" className="text-sm text-[#6B7280] transition hover:text-[#1F2937]">
            Pricing
          </Link>
          <Link href="/login" className="text-sm text-[#6B7280] transition hover:text-[#1F2937]">
            Log in
          </Link>
          <Link
            href="/signup"
            className="rounded-xl bg-[#7C9A92] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#6D8C7D]"
          >
            Get started
          </Link>
        </nav>
      </header>

      {/* 1. Hero */}
      <section className="mx-auto max-w-3xl px-6 pb-16 pt-14 text-center sm:pt-20">
        <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          A gentler daily plan for food, energy and habits.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-[#6B7280]">
          Mellowa turns your mood, energy and schedule into a realistic plan for
          meals, hydration, movement, stress resets and calmer evenings —
          without strict dieting or overwhelm.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/signup"
            className="rounded-xl bg-[#7C9A92] px-6 py-3.5 font-medium text-white transition hover:bg-[#6D8C7D]"
          >
            Create my free sample plan
          </Link>
          <a
            href="#how-it-works"
            className="rounded-xl border border-[#E5E1DA] bg-white px-6 py-3.5 font-medium text-[#1F2937] transition hover:border-[#7C9A92]/50"
          >
            See how it works
          </a>
        </div>
        <p className="mt-4 text-sm text-[#9CA3AF]">
          No card for the sample. Premium starts with a 3-day trial when you
          choose a plan.
        </p>
      </section>

      {/* Low-energy emphasis */}
      <section className="mx-auto max-w-3xl px-6 pt-4 text-center">
        <p className="mx-auto max-w-xl text-[#6B7280]">
          For the days when your energy is low, Mellowa makes the plan{" "}
          <span className="font-medium text-[#1F2937]">smaller — not stricter.</span>
        </p>
      </section>

      {/* 2. Problem */}
      <section className="mx-auto max-w-3xl px-6 py-12 text-center">
        <h2 className="text-2xl font-semibold tracking-tight">
          Too much wellness advice. Not enough daily structure.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-[#6B7280]">
          You already know walks help, water helps, sleep helps. The hard part
          is fitting any of it into a real day with real energy levels — without
          another rigid program that falls apart by Wednesday.
        </p>
      </section>

      {/* 3. Solution */}
      <section className="mx-auto max-w-3xl px-6 py-12">
        <div className="rounded-3xl bg-[#7C9A92] p-8 text-center text-white sm:p-12">
          <h2 className="text-2xl font-semibold tracking-tight">
            One realistic plan, based on your energy, mood and schedule.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-white/85">
            Tell Mellowa how today feels. Get a plan that fits — simpler on
            low-energy days, shorter on stressful ones, always doable.
          </p>
        </div>
      </section>

      {/* 4. How it works */}
      <section id="how-it-works" className="mx-auto max-w-5xl px-6 py-12">
        <h2 className="text-center text-2xl font-semibold tracking-tight">How it works</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {HOW_IT_WORKS.map((item) => (
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

      {/* 5. What your plan includes */}
      <section className="mx-auto max-w-5xl px-6 py-12">
        <h2 className="text-center text-2xl font-semibold tracking-tight">
          What your daily plan includes
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PLAN_INCLUDES.map((item) => (
            <div key={item.label} className="rounded-2xl bg-white p-6 shadow-sm">
              <item.icon className="h-5 w-5 text-[#7C9A92]" />
              <h3 className="mt-3 font-medium">{item.label}</h3>
              <p className="mt-1 text-sm text-[#6B7280]">{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 6. Why it feels different */}
      <section className="mx-auto max-w-3xl px-6 py-12">
        <h2 className="text-center text-2xl font-semibold tracking-tight">
          Why it feels different
        </h2>
        <ul className="mx-auto mt-6 max-w-xl space-y-3">
          {[
            "No calorie counting, no restriction, no diet culture.",
            "Plans shrink on hard days instead of guilting you.",
            "Every habit has a minimum version — the smallest possible win.",
            "No streaks, no shame, no red warning badges.",
            "Warm, calm language. Like a kind friend who's good at planning.",
          ].map((line) => (
            <li key={line} className="flex items-start gap-3 rounded-2xl bg-white px-5 py-4 shadow-sm">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#7C9A92]" />
              <span className="text-sm">{line}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* 7. Safety note */}
      <section className="mx-auto max-w-3xl px-6 py-8">
        <div className="rounded-2xl bg-[#EEF2FF] px-6 py-5 text-center text-sm leading-relaxed text-[#1F2937]">
          Mellowa is not medical care, therapy or emergency support. It offers
          general wellbeing routines and habit structure. For medical
          conditions, eating disorder concerns, pregnancy or severe mental
          health symptoms, please seek qualified professional support.
        </div>
      </section>

      {/* 8. Pricing preview */}
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
            <p className="mt-1 text-sm text-[#6B7280]">Best value. 3 days free.</p>
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
          Tomorrow can feel a little calmer.
        </h2>
        <p className="mt-2 text-[#6B7280]">
          One check-in. One realistic plan. One small habit.
        </p>
        <Link
          href="/signup"
          className="mt-6 inline-block rounded-xl bg-[#7C9A92] px-6 py-3.5 font-medium text-white transition hover:bg-[#6D8C7D]"
        >
          Create my free sample plan
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
          <a href="mailto:support@mellowa.app" className="hover:text-[#6D8C7D]">
            Support
          </a>
        </div>
        © {new Date().getFullYear()} Mellowa. Not medical care, therapy or
        emergency support.
      </footer>
    </div>
  );
}
