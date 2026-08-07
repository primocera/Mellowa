"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Sun,
  CalendarDays,
  BookHeart,
  User,
  LogOut,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { trackClient } from "@/lib/analytics/client";
import { hubForPath, type Hub } from "@/lib/nav/hubs";
import type { NavEntitlement } from "@/lib/nav/entitlement";
import clsx from "clsx";

// MW-V9-01: four calm primary destinations chosen by daily job and frequency,
// not by how many generators exist. Today is the daily home; check-in is a
// contextual Today action, not a competing destination. Detail pages (weekly
// plan, meal rhythm, shopping, movement, resets, habits, journal, patterns,
// billing, settings, privacy) live inside these hubs and stay reachable by
// their original URLs.
const NAV_ITEMS: {
  href: string;
  label: string;
  icon: typeof Sun;
  surface: string;
  hub: Hub;
}[] = [
  { href: "/today", label: "Today", icon: Sun, surface: "today", hub: "today" },
  { href: "/plan", label: "Week", icon: CalendarDays, surface: "week", hub: "week" },
  { href: "/library", label: "Saved", icon: BookHeart, surface: "saved", hub: "saved" },
  { href: "/you", label: "You", icon: User, surface: "you", hub: "you" },
];

export type { NavEntitlement } from "@/lib/nav/entitlement";

export function AppNav({ entitlement = "unknown" }: { entitlement?: NavEntitlement }) {
  const pathname = usePathname();
  const router = useRouter();
  // MW-95-04: one resolver decides the active hub for BOTH nav variants, so a
  // detail route (/weekly-plan, /billing, …) lights its canonical parent and an
  // unknown route lights none. No route can highlight two hubs.
  const activeHub = hubForPath(pathname);

  function onNavigate(surface: string) {
    // primary_nav_viewed: destination + entitlement category only (MW-V9-01).
    trackClient("primary_nav_viewed", { surface, entitlement });
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r border-[#EDE9E2] bg-white px-4 py-6 md:flex">
        <Link href="/today" className="mb-8 px-2 text-lg font-semibold tracking-tight text-[#1F2937]">
          Mellowa
        </Link>
        <nav aria-label="Primary" className="flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon, surface, hub }) => (
            <Link
              key={href}
              href={href}
              aria-current={activeHub === hub ? "page" : undefined}
              onClick={() => onNavigate(surface)}
              className={clsx(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
                activeHub === hub
                  ? "bg-[#7C9A92]/10 font-medium text-[#6D8C7D]"
                  : "text-[#6B7280] hover:bg-[#FAF7F2] hover:text-[#1F2937]"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>
        <button
          onClick={signOut}
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-[#6B7280] transition hover:bg-[#FAF7F2] hover:text-[#1F2937]"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </aside>

      {/* Mobile bottom nav — four evenly spaced destinations */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-[#EDE9E2] bg-white px-2 py-2 md:hidden"
      >
        {NAV_ITEMS.map(({ href, label, icon: Icon, surface, hub }) => (
          <Link
            key={href}
            href={href}
            aria-current={activeHub === hub ? "page" : undefined}
            onClick={() => onNavigate(surface)}
            className={clsx(
              "flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1 text-[11px]",
              activeHub === hub ? "text-[#6D8C7D]" : "text-[#6B7280]"
            )}
          >
            <Icon className="h-5 w-5" />
            {label}
          </Link>
        ))}
      </nav>
    </>
  );
}
