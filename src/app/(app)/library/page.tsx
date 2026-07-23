import type { Metadata } from "next";
import { Heart, Utensils, Footprints, Wind } from "lucide-react";
import { HubLinks, type HubLink } from "@/components/layout/hub-links";

// MW-V9-01: the "Saved" primary destination. Route stays /library so existing
// deep links keep working; the user-facing label is Saved. Reusable resources
// are grouped by type — meals you kept, and reviewed practices.
export const metadata: Metadata = { title: "Saved — Mellowa" };

const MEALS: HubLink[] = [
  {
    href: "/favourites",
    label: "Saved meals",
    description: "Meals worth using again.",
    icon: Heart,
  },
  {
    href: "/meal-rhythm",
    label: "Meal ideas",
    description: "Simple meal rhythm ideas you can reuse.",
    icon: Utensils,
  },
];

const PRACTICES: HubLink[] = [
  {
    href: "/movement",
    label: "Movement",
    description: "Short options for different energy levels.",
    icon: Footprints,
  },
  {
    href: "/stress-reset",
    label: "Resets",
    description: "Brief practices for everyday tension or overload.",
    icon: Wind,
  },
];

export default function SavedPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-[#1F2937]">
          Yours to revisit
        </h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          Meals you kept and reviewed practices you can reuse without creating a
          new plan.
          {" Browsing Saved is always free and doesn’t use plan generation."}
        </p>
      </header>

      <section className="space-y-3" aria-labelledby="saved-meals">
        <h2
          id="saved-meals"
          className="text-xs font-medium uppercase tracking-wide text-[#9CA3AF]"
        >
          Meals
        </h2>
        <HubLinks links={MEALS} />
      </section>

      <section className="space-y-3" aria-labelledby="saved-practices">
        <h2
          id="saved-practices"
          className="text-xs font-medium uppercase tracking-wide text-[#9CA3AF]"
        >
          Practices
        </h2>
        <HubLinks links={PRACTICES} />
      </section>
    </div>
  );
}
