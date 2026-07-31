import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

/**
 * MW-V11-05: Core Web Vitals collection on the launch path.
 *
 * Performance was the last piece of launch evidence that had never been
 * measured at all — every previous release said "no score is claimed", which
 * was honest but is not the same as knowing. This collects the numbers with the
 * tools already in the repo rather than adding a vendor dependency, and writes
 * a machine-readable report so the run is reproducible at the candidate SHA.
 *
 * What these numbers are, stated precisely so nobody over-reads them:
 *
 *  - **Lab, not field.** One cold load per route in headless Chromium on one
 *    machine, with CPU and network throttled to approximate a mid-range phone.
 *    Real-user p75 will differ, and this cannot substitute for it.
 *  - **LCP and CLS are measured**, from the same PerformanceObserver entries
 *    the browser reports to real-user tooling.
 *  - **INP is not measured.** INP needs real interactions over a session. What
 *    is recorded instead is a labelled interaction-latency probe: the time from
 *    a click to the next paint. It is a proxy and is named as one.
 *
 * Run with `npm run perf`. It is its own Playwright project, so it never runs
 * inside the normal suite and never runs three times across the viewport
 * projects. Not running it is recorded as not-run, never as a pass.
 */

/**
 * MW-V12-07: warm vs cold are measured and labelled separately.
 *
 * `PERF_MODE=cold` skips the warm-up request so the measured navigation pays
 * server start-up — the first-visit experience on a cold serverless function.
 * Run it against a deployed preview (E2E_BASE_URL=https://<preview>) — a local
 * `next start` has no cold serverless start, so a local cold run is not
 * representative. Warm is the release gate; cold is recorded and advisory, so
 * one flaky cold run can never be the only thing standing between a candidate
 * and a verdict.
 */
const MODE: "warm" | "cold" = process.env.PERF_MODE === "cold" ? "cold" : "warm";

/** Launch budgets, with the reasoning that picked them. */
const BUDGETS = {
  // Google's "good" threshold. A daily consumer product that hesitates on the
  // first screen loses the user before it has said anything.
  lcpMs: 2500,
  // Layout shift is the failure people describe as "it moved as I tapped".
  cls: 0.1,
  // Not a Core Web Vital, but a server that is slow to first byte makes every
  // downstream number worse and is the cheapest thing to notice early.
  ttfbMs: 800,
};

interface VitalsReport {
  route: string;
  mode: "warm" | "cold";
  ttfbMs: number;
  fcpMs: number | null;
  lcpMs: number | null;
  lcpElement: string | null;
  cls: number;
  longTasks: number;
  longTaskMsTotal: number;
  transfer: { total: number; script: number; style: number; font: number; image: number };
  requestCount: number;
}

/** Mid-range phone: 4× CPU slowdown, ~Slow 4G. */
async function throttle(page: Page): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
}

async function collect(page: Page, route: string): Promise<VitalsReport> {
  // Byte accounting comes from the Resource Timing API, not response headers.
  // Headers undercount badly: a compressed response usually has no
  // content-length, so a header-based tally reported 0 bytes of JavaScript on a
  // page that clearly ships some. transferSize is what the browser actually
  // received, compression included.

  // Observers must be installed before navigation or the early entries are lost.
  await page.addInitScript(() => {
    const w = window as unknown as {
      __vitals: { lcp: number | null; lcpElement: string | null; cls: number; longTasks: number[] };
    };
    w.__vitals = { lcp: null, lcpElement: null, cls: 0, longTasks: [] };

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEntry & { element?: Element; startTime: number };
        w.__vitals.lcp = e.startTime;
        w.__vitals.lcpElement = e.element
          ? `${e.element.tagName.toLowerCase()}${e.element.className ? "." + String(e.element.className).split(" ")[0] : ""}`
          : null;
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
        // Shifts within 500ms of an interaction are the user's doing.
        if (!e.hadRecentInput) w.__vitals.cls += e.value;
      }
    }).observe({ type: "layout-shift", buffered: true });

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__vitals.longTasks.push(entry.duration);
    }).observe({ type: "longtask", buffered: true });
  });

  /*
   * Warm the route before measuring.
   *
   * The first measurement run reported LCP 4080ms on the landing page and 956ms
   * TTFB on /pricing. Both were cold-server artifacts: the very first request to
   * a route pays server start-up, and that number describes the harness, not
   * the page. The same route measured 840ms LCP once warm — a 5x difference,
   * entirely from what was being measured.
   *
   * So: warm first, then measure steady state, and record cold-start separately
   * rather than letting it masquerade as the page's performance. Neither number
   * alone is the truth a user experiences; the warm one is what the budgets are
   * set against, and cold start is called out in the report caveat.
   */
  /*
   * Warm via the API request context, NOT by navigating.
   *
   * Navigating twice warmed the browser cache as well as the server, so the
   * measured load reported 15KB transferred instead of 247KB — every asset was
   * a cache hit with transferSize 0. That flatters the byte budget by
   * measuring a returning visitor while claiming to measure a first visit.
   * `page.request` shares cookies but not the page's HTTP cache, so this warms
   * the server only and the measured navigation is still a cold-cache load.
   */
  // Cold mode deliberately skips the warm-up so server start-up is included.
  if (MODE === "warm") {
    await page.request.get(route).catch(() => {
      /* a warm-up failure is not a result; the measured load below is */
    });
  }

  await page.goto(route, { waitUntil: "load" });
  // Let LCP settle: it is only final once the page stops changing.
  await page.waitForTimeout(2500);

  const measured = await page.evaluate(() => {
    const w = window as unknown as {
      __vitals: { lcp: number | null; lcpElement: string | null; cls: number; longTasks: number[] };
    };
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const fcp = performance
      .getEntriesByType("paint")
      .find((p) => p.name === "first-contentful-paint");

    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const transfer = { total: 0, script: 0, style: 0, font: 0, image: 0 };
    for (const r of resources) {
      const bytes = r.transferSize || 0;
      transfer.total += bytes;
      if (r.initiatorType === "script" || /\.js(\?|$)/.test(r.name)) transfer.script += bytes;
      else if (r.initiatorType === "css" || /\.css(\?|$)/.test(r.name)) transfer.style += bytes;
      else if (/\.(woff2?|ttf|otf)(\?|$)/.test(r.name)) transfer.font += bytes;
      else if (r.initiatorType === "img" || /\.(png|jpe?g|svg|webp|avif)(\?|$)/.test(r.name))
        transfer.image += bytes;
    }
    transfer.total += nav?.transferSize ?? 0;

    return {
      ttfbMs: nav ? nav.responseStart - nav.requestStart : 0,
      fcpMs: fcp ? fcp.startTime : null,
      lcpMs: w.__vitals.lcp,
      lcpElement: w.__vitals.lcpElement,
      cls: w.__vitals.cls,
      longTasks: w.__vitals.longTasks.length,
      longTaskMsTotal: Math.round(w.__vitals.longTasks.reduce((a, b) => a + b, 0)),
      transfer,
      requestCount: resources.length + 1,
    };
  });

  return {
    route,
    mode: MODE,
    ttfbMs: Math.round(measured.ttfbMs),
    fcpMs: measured.fcpMs === null ? null : Math.round(measured.fcpMs),
    lcpMs: measured.lcpMs === null ? null : Math.round(measured.lcpMs),
    lcpElement: measured.lcpElement,
    cls: Number(measured.cls.toFixed(4)),
    longTasks: measured.longTasks,
    longTaskMsTotal: measured.longTaskMsTotal,
    transfer: measured.transfer,
    requestCount: measured.requestCount,
  };
}

const REPORT_DIR = "docs/release/evidence/v11/perf";
const reports: VitalsReport[] = [];

test.afterAll(() => {
  if (reports.length === 0) return;
  mkdirSync(REPORT_DIR, { recursive: true });
  // Warm keeps the canonical filename the release manifest pins; cold is a
  // separate, clearly-labelled artifact so the two are never conflated.
  writeFileSync(
    `${REPORT_DIR}/${MODE === "warm" ? "vitals.json" : "vitals-cold.json"}`,
    JSON.stringify(
      {
        collectedAtUtc: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
        mode: MODE,
        conditions:
          `headless Chromium, 4x CPU throttle, ~Slow 4G (1.6Mbps/150ms), ${MODE} run ` +
          (MODE === "warm"
            ? "(route warmed once before measuring)"
            : "(no warm-up — server start-up is included; run against a deployed preview)"),
        caveat:
          "Lab measurement on one machine, steady state after a warm-up request. Not real-user p75. " +
          "Cold-start is deliberately excluded and is a separate risk: the first request to a cold " +
          "route measured 4080ms LCP on the landing page versus 840ms warm, so a user unlucky enough " +
          "to hit a cold serverless function sees materially worse than these numbers. " +
          "INP is not measured; the interaction probe is a labelled proxy.",
        budgets: BUDGETS,
        routes: reports,
      },
      null,
      2
    ) + "\n"
  );
});

for (const route of ["/", "/pricing", "/signup"]) {
  test(`vitals: ${route}`, async ({ page }) => {
    await throttle(page);
    const report = await collect(page, route);
    reports.push(report);

    // Logged so the numbers are in the run output as well as the JSON.
    console.log(`PERF ${route}`, JSON.stringify(report));

    expect(report.lcpMs, `${route}: LCP was never reported`).not.toBeNull();

    // Warm is the gate. Cold is recorded and advisory — a single cold run pays
    // server start-up and is too noisy to fail a release on by itself; it is
    // labelled `cold` in the artifact and read as a separate signal.
    if (MODE === "warm") {
      expect(report.lcpMs!, `${route}: LCP ${report.lcpMs}ms exceeds ${BUDGETS.lcpMs}ms`).
        toBeLessThanOrEqual(BUDGETS.lcpMs);
      expect(report.cls, `${route}: CLS ${report.cls} exceeds ${BUDGETS.cls}`).toBeLessThanOrEqual(
        BUDGETS.cls
      );
      expect(
        report.ttfbMs,
        `${route}: TTFB ${report.ttfbMs}ms exceeds ${BUDGETS.ttfbMs}ms`
      ).toBeLessThanOrEqual(BUDGETS.ttfbMs);
    }
  });
}

/**
 * Interaction latency probe — explicitly NOT INP.
 *
 * The header disclosure is the only interactive control on the public landing
 * page, so it is the one thing a visitor can make the page do before signing
 * up. If opening it is not perceptibly instant, nothing later will feel better.
 */
test("interaction probe: opening the header menu", async ({ page }) => {
  await throttle(page);
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/", { waitUntil: "load" });

  const menu = page.locator("header button");
  await expect(menu).toBeVisible();

  const latencyMs = await page.evaluate(async () => {
    const button = document.querySelector("header button") as HTMLButtonElement;
    const start = performance.now();
    button.click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return performance.now() - start;
  });

  console.log(`PERF interaction probe (not INP): ${Math.round(latencyMs)}ms`);
  // 200ms is the INP "good" threshold; used here as a sanity ceiling on a
  // purely local state toggle, which should be far below it.
  expect(latencyMs, `header menu took ${Math.round(latencyMs)}ms to paint`).toBeLessThan(200);
});
