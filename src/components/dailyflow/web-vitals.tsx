"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  deviceClassForWidth,
  rateVital,
  sanitizeRoute,
  type VitalMetric,
} from "@/lib/perf/web-vitals";

/**
 * Real-user Web Vitals collector (MW-V12-07).
 *
 * Measures LCP, CLS and INP from the same PerformanceObserver entries the
 * browser reports, and beacons the final values once on page hide. Strictly
 * anonymous: it sends only the metric, a bucketed value, the app route, a
 * coarse device class and the build id — never a user id, session, IP, query
 * string or any wellbeing content. Analytics must never break a page, so every
 * step is wrapped and failure is silent.
 *
 * This is field data. It complements, and does not replace, the warm-lab perf
 * suite — the two are labelled separately everywhere they are reported.
 */
export function WebVitals({ buildId }: { buildId: string }) {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") return;

    let lcp: number | null = null;
    let cls = 0;
    let inp = 0; // max interaction latency seen
    let sent = false;
    const observers: PerformanceObserver[] = [];

    const observe = (type: string, cb: (entries: PerformanceEntryList) => void) => {
      try {
        const po = new PerformanceObserver((list) => cb(list.getEntries()));
        // buffered so entries before this ran are not lost.
        po.observe({ type, buffered: true } as PerformanceObserverInit);
        observers.push(po);
      } catch {
        /* unsupported entry type on this browser — skip it */
      }
    };

    observe("largest-contentful-paint", (entries) => {
      const last = entries[entries.length - 1] as PerformanceEntry & { startTime: number };
      if (last) lcp = last.startTime;
    });

    observe("layout-shift", (entries) => {
      for (const e of entries as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
        if (!e.hadRecentInput) cls += e.value;
      }
    });

    // INP approximation: the largest interaction latency across the visit.
    observe("event", (entries) => {
      for (const e of entries as (PerformanceEntry & { duration: number; interactionId?: number })[]) {
        if (e.interactionId && e.duration > inp) inp = e.duration;
      }
    });

    const beacon = (metric: VitalMetric, value: number) => {
      try {
        const body = JSON.stringify({
          metric,
          value,
          rating: rateVital(metric, value),
          route: sanitizeRoute(pathname || window.location.pathname),
          deviceClass: deviceClassForWidth(window.innerWidth),
          buildId,
        });
        const blob = new Blob([body], { type: "application/json" });
        if (navigator.sendBeacon) navigator.sendBeacon("/api/vitals", blob);
        else void fetch("/api/vitals", { method: "POST", body, keepalive: true });
      } catch {
        /* analytics must never break the page */
      }
    };

    const report = () => {
      if (sent) return;
      sent = true;
      if (lcp !== null) beacon("LCP", lcp);
      beacon("CLS", cls);
      if (inp > 0) beacon("INP", inp);
    };

    // Page hide is the reliable "session over" signal on mobile; visibilitychange
    // to hidden covers tab switches and the bfcache path.
    const onHidden = () => {
      if (document.visibilityState === "hidden") report();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", report);

    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", report);
      for (const po of observers) po.disconnect();
    };
  }, [pathname, buildId]);

  return null;
}
