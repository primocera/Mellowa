"use client";

import Link from "next/link";
import { trackClient } from "@/lib/analytics/client";
import type { AppEvent } from "@/lib/analytics/taxonomy";

/**
 * A Link that records a privacy-safe click event before navigating
 * (Launch v6, Prompt 20). `surface` and optional `plan_interval` come from a
 * closed enum in the taxonomy — no free text can ride along.
 */
export function TrackedCta({
  href,
  event,
  surface,
  planInterval,
  className,
  children,
}: {
  href: string;
  event: AppEvent;
  surface: string;
  planInterval?: "monthly" | "yearly";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() =>
        trackClient(event, {
          surface,
          ...(planInterval ? { plan_interval: planInterval } : {}),
        })
      }
    >
      {children}
    </Link>
  );
}
