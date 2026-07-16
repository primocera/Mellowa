"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Sun,
  CalendarDays,
  BookHeart,
  TrendingUp,
  User,
  LogOut,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import clsx from "clsx";

// Prompt 10: five calm top-level destinations. Detail pages (weekly plan,
// meal rhythm, shopping, movement, calm, habits, journal, billing, settings)
// live inside these hubs and are still reachable by their original URLs.
const NAV_ITEMS = [
  { href: "/today", label: "Today", icon: Sun },
  { href: "/plan", label: "Plan", icon: CalendarDays },
  { href: "/library", label: "Library", icon: BookHeart },
  { href: "/progress", label: "Progress", icon: TrendingUp },
  { href: "/you", label: "You", icon: User },
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
        <Link href="/today" className="mb-8 px-2 text-lg font-semibold tracking-tight text-[#1F2937]">
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

      {/* Mobile bottom nav — five evenly spaced destinations */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-[#EDE9E2] bg-white px-2 py-2 md:hidden">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={pathname.startsWith(href) ? "page" : undefined}
            className={clsx(
              "flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1 text-[11px]",
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
