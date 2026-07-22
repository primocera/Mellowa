import type { Metadata } from "next";
import { SlidersHorizontal, CreditCard, ShieldCheck, LifeBuoy, TrendingUp } from "lucide-react";
import { HubLinks, type HubLink } from "@/components/layout/hub-links";

export const metadata: Metadata = { title: "You — Mellowa" };

const LINKS: HubLink[] = [
  {
    href: "/settings",
    label: "Plan preferences",
    description:
      "Schedule, food, plan size, reminders and optional nutrition details.",
    icon: SlidersHorizontal,
  },
  {
    // MW-V9-01: Patterns is no longer a top-level destination (it competed
    // with the daily job); it stays reachable here as a personal review of
    // your own recorded facts — never scoring or judgment.
    href: "/progress",
    label: "Patterns",
    description: "Notice what repeats, without scoring yourself. Your journal lives here too.",
    icon: TrendingUp,
  },
  {
    href: "/billing",
    label: "Membership & billing",
    description: "Trial, renewal, payment method and cancellation.",
    icon: CreditCard,
  },
  {
    href: "/settings#data",
    label: "Data & privacy",
    description: "Export, correct or delete what you have shared.",
    icon: ShieldCheck,
  },
  {
    href: "/help",
    label: "Help & policies",
    description: "Support, Terms, Privacy and Refund Policy.",
    icon: LifeBuoy,
  },
];

export default function YouPage() {
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-[#1F2937]">
          Your Mellowa
        </h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          Shape your plans, manage membership and control your data.
        </p>
      </header>
      <HubLinks links={LINKS} />
    </div>
  );
}
