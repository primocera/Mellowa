import type { Metadata } from "next";
import { Heart, Footprints, Wind } from "lucide-react";
import { HubLinks, type HubLink } from "@/components/layout/hub-links";

export const metadata: Metadata = { title: "Library — Mellowa" };

const LINKS: HubLink[] = [
  {
    href: "/favourites",
    label: "Saved meals",
    description: "Meals you loved, ready to reuse.",
    icon: Heart,
  },
  {
    href: "/movement",
    label: "Movement",
    description: "Small, doable ways to move today.",
    icon: Footprints,
  },
  {
    href: "/stress-reset",
    label: "Calm",
    description: "Short resets for busy moments.",
    icon: Wind,
  },
];

export default function LibraryPage() {
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-[#1F2937]">
          Library
        </h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          Saved meals, movement and calm — whenever you need them.
        </p>
      </header>
      <HubLinks links={LINKS} />
    </div>
  );
}
