import type { Metadata } from "next";
import { CalendarDays, Utensils, ShoppingBasket } from "lucide-react";
import { HubLinks, type HubLink } from "@/components/layout/hub-links";

export const metadata: Metadata = { title: "Week — Mellowa" };

const LINKS: HubLink[] = [
  {
    href: "/weekly-plan",
    label: "Week at a glance",
    description: "See the shape of the days ahead.",
    icon: CalendarDays,
  },
  {
    href: "/meal-rhythm",
    label: "Meal rhythm",
    description: "Make regular eating easier across different kinds of days.",
    icon: Utensils,
  },
  {
    href: "/weekly-plan#shopping",
    label: "Shopping list",
    description: "Build an editable list from meals you want to use.",
    icon: ShoppingBasket,
  },
];

export default function PlanPage() {
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-[#1F2937]">
          Make the week easier
        </h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          A loose structure for meals, routines and shopping—not a schedule you
          have to follow.
        </p>
      </header>
      <HubLinks links={LINKS} />
    </div>
  );
}
