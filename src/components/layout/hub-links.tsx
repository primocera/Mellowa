import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";

export type HubLink = {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
};

/**
 * Shared list of large, calm tap targets used by the consolidated section
 * hubs (Plan, Library, You). Each row is a full-width card so it comfortably
 * clears the 44px touch-target minimum on mobile (Prompt 10 / 19).
 */
export function HubLinks({ links }: { links: HubLink[] }) {
  return (
    <nav className="space-y-3">
      {links.map(({ href, label, description, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow-sm transition hover:bg-[#7C9A92]/5"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#7C9A92]/10 text-[#6D8C7D]">
            <Icon className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-[#1F2937]">
              {label}
            </span>
            <span className="block text-xs text-[#6B7280]">{description}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-[#9CA3AF]" aria-hidden />
        </Link>
      ))}
    </nav>
  );
}
