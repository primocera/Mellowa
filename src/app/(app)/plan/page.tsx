import type { Metadata } from "next";
import { CalendarDays, Utensils, ShoppingBasket } from "lucide-react";
import { HubLinks, type HubLink } from "@/components/layout/hub-links";

export const metadata: Metadata = { title: "Plan — Mellowa" };

const LINKS: HubLink[] = [
  {
    href: "/weekly-plan",
    label: "Weekly plan",
    description: "A gentle rhythm for the week ahead.",
    icon: CalendarDays,
  },
  {
    href: "/meal-rhythm",
    label: "Meal rhythm",
    description: "Simple meal ideas that fit your days.",
    icon: Utensils,
  },
  {
    href: "/weekly-plan#shopping",
    label: "Shopping list",
    description: "Everything you need, grouped and ready.",
    icon: ShoppingBasket,
  },
];

export default function PlanPage() {
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-[#1F2937]">
          Plan
        </h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          Your week, meals and shopping — all in one calm place.
        </p>
      </header>
      <HubLinks links={LINKS} />
    </div>
  );
}
