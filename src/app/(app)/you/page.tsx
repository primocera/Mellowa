import type { Metadata } from "next";
import { SlidersHorizontal, CreditCard, ShieldCheck, LifeBuoy } from "lucide-react";
import { HubLinks, type HubLink } from "@/components/layout/hub-links";

export const metadata: Metadata = { title: "You — Mellowa" };

const LINKS: HubLink[] = [
  {
    href: "/settings",
    label: "Profile & preferences",
    description: "How your plans are shaped.",
    icon: SlidersHorizontal,
  },
  {
    href: "/billing",
    label: "Billing",
    description: "Your plan, trial and payments.",
    icon: CreditCard,
  },
  {
    href: "/settings#data",
    label: "Your data",
    description: "Export or delete anything you've shared.",
    icon: ShieldCheck,
  },
  {
    href: "/terms",
    label: "Support & policies",
    description: "Terms, privacy and how to reach us.",
    icon: LifeBuoy,
  },
];

export default function YouPage() {
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-[#1F2937]">
          You
        </h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          Your profile, billing, data and support.
        </p>
      </header>
      <HubLinks links={LINKS} />
    </div>
  );
}
