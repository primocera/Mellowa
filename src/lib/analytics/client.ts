"use client";

import type { AppEvent } from "@/lib/analytics/taxonomy";

/**
 * Client-side event beacon (Launch v6, Prompt 20).
 *
 * Sends only view/click events to /api/events, which re-validates every name
 * and property against the privacy-safe taxonomy and rejects anything
 * server-authoritative. No mood/journal/meal content is ever passed — callers
 * may only send the enumerated properties (surface, plan_interval, source…).
 *
 * A single opaque anon id is stored in localStorage for pre-signup funnel
 * stitching; it is a random slug, not a fingerprint, and is dropped once the
 * user is signed in (the endpoint attributes to the real user then).
 */

const ANON_KEY = "mellowa_anon_id";

function anonId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    let id = window.localStorage.getItem(ANON_KEY);
    if (!id) {
      id = (crypto.randomUUID?.() ?? `a-${Date.now()}-${Math.random().toString(36).slice(2)}`)
        .replace(/[^a-z0-9-]/gi, "")
        .toLowerCase()
        .slice(0, 64);
      window.localStorage.setItem(ANON_KEY, id);
    }
    return id;
  } catch {
    return undefined;
  }
}

export function trackClient(
  event: AppEvent,
  properties: Record<string, string> = {}
): void {
  try {
    const body = JSON.stringify({ event, properties, anon_id: anonId() });
    // Beacon survives navigation (CTA click → route change) without blocking.
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
  } catch {
    // Analytics must never break a user action.
  }
}
