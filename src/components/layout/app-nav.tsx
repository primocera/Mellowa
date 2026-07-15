"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Sun,
  CalendarDays,
  Wind,
  Footprints,
  Repeat,
  BookOpen,
  Heart,
  TrendingUp,
  Settings,
  LogOut,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import clsx from "clsx";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/today", label: "Today", icon: Sun },
  { href: "/weekly-plan", label: "Weekly Plan", icon: CalendarDays },
  { href: "/stress-reset", label: "Stress Reset", icon: Wind },
  { href: "/movement", label: "Movement", icon: Footprints },
  { href: "/habits", label: "Habits", icon: Repeat },
  { href: "/journal", label: "Journal", icon: BookOpen },
  { href: "/favourites", label: "Favourites", icon: Heart },
  { href: "/progress", label: "Progress", icon: TrendingUp },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();

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
        <Link href="/dashboard" className="mb-8 px-2 text-lg font-semibold tracking-tight text-[#1F2937]">
          Mellowa
        </Link>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
                pathname.startsWith(href)
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

      {/* Mobile bottom nav — horizontally scrollable */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex gap-1 overflow-x-auto border-t border-[#EDE9E2] bg-white px-2 py-2 md:hidden">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={clsx(
              "flex shrink-0 flex-col items-center gap-0.5 rounded-lg px-3 py-1 text-[11px]",
              pathname.startsWith(href) ? "text-[#6D8C7D]" : "text-[#6B7280]"
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
