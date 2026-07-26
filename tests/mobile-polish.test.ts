import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * MW-V10-07: mobile polish, accessibility and failure-state coverage.
 *
 * These assert structural facts a browser test would be slow and flaky at:
 * which routes have a loading/error boundary, whether the most-tapped controls
 * meet 44px, and whether the Today page can still present a stale plan as
 * today's. The browser-level checks (real 320px layout, keyboard focus, nav
 * overlap) live in e2e/daily-journey.spec.ts and e2e/public.spec.ts.
 */

const read = (p: string) => readFileSync(p, "utf8");

describe("no primary route blanks on failure", () => {
  it("the authenticated shell has an error boundary", () => {
    expect(existsSync("src/app/(app)/error.tsx")).toBe(true);
  });

  it("the PUBLIC routes have one too", () => {
    // Previously only the app shell was covered, so a failure on the landing,
    // pricing or legal pages showed Next's default error screen — on the first
    // page a prospective user ever sees.
    expect(existsSync("src/app/error.tsx")).toBe(true);
    const src = read("src/app/error.tsx");
    expect(src).toMatch(/Try again/);
    expect(src).toMatch(/Nothing was saved or\s+changed/);
  });

  it("a root-layout failure has a last-resort boundary", () => {
    expect(existsSync("src/app/global-error.tsx")).toBe(true);
    const src = read("src/app/global-error.tsx");
    // It must render its own document and import nothing shared: any import
    // could be the module that failed.
    expect(src).toMatch(/<html/);
    expect(src).toMatch(/<body/);
    expect(src).not.toMatch(/@\/components|@\/lib/);
  });

  it("error boundaries log a digest and never a message or stack", () => {
    for (const file of ["src/app/error.tsx", "src/app/(app)/error.tsx"]) {
      const src = read(file);
      expect(src, file).toMatch(/digest: error\.digest/);
      expect(src, file).not.toMatch(/error\.message|error\.stack/);
    }
  });

  it("errors distinguish what was preserved from what needs action", () => {
    expect(read("src/app/(app)/error.tsx")).toMatch(/data are safe/i);
    expect(read("src/app/global-error.tsx")).toMatch(/unaffected/i);
  });
});

describe("high-traffic routes do not blank while loading", () => {
  const ROUTES = ["today", "check-in", "billing", "you", "weekly-plan"];

  it.each(ROUTES)("(app)/%s has a loading skeleton", (route) => {
    expect(existsSync(`src/app/(app)/${route}/loading.tsx`)).toBe(true);
  });

  it.each(ROUTES)("(app)/%s skeleton is announced and motion-safe", (route) => {
    const src = read(`src/app/(app)/${route}/loading.tsx`);
    expect(src).toMatch(/aria-busy="true"/);
    expect(src).toMatch(/aria-label=/);
    // Motion is disabled under prefers-reduced-motion via the shared Skeleton.
    expect(src).toContain("Skeleton");
  });

  it("skeletons come from the shared primitive, not per-route markup", () => {
    for (const route of ROUTES) {
      expect(read(`src/app/(app)/${route}/loading.tsx`)).toContain(
        'from "@/components/ui"'
      );
    }
  });
});

describe("Today never presents another day's plan as today's", () => {
  const page = read("src/app/(app)/today/page.tsx");

  it("compares the plan's own date against the resolved local date", () => {
    expect(page).toMatch(/latestPlan\.plan_date === assumedLocalDate/);
  });

  it("has no rolling-window fallback that could match yesterday", () => {
    // The old fallback did `.gte("plan_date", yesterday)` for an unknown
    // timezone, so a plan from yesterday satisfied the query and was then
    // rendered under "Today · plan ready".
    expect(page).not.toMatch(/gte\("plan_date"/);
    expect(page).not.toMatch(/setDate\(now\.getDate\(\) - 1\)/);
  });

  it("names the real date of a non-today plan and frames it as history", () => {
    expect(page).toContain("stalePlan");
    expect(page).toMatch(/formatPlanDate/);
    expect(page).toMatch(/not today/i);
  });

  it("still prompts to repair an unknown timezone rather than guessing quietly", () => {
    expect(page).toContain("timezoneNeedsRepair");
    expect(page).toContain("TimezoneRepair");
  });

  it("parallelizes the two independent reads", () => {
    expect(page).toMatch(/await Promise\.all\(\[/);
  });
});

describe("touch targets on the most-tapped screen", () => {
  const today = read("src/components/dailyflow/today-plan-v2.tsx");

  it("the Now card's primary and secondary actions use the shared 44px button", () => {
    expect(today).toContain('buttonClass("primary")');
    expect(today).toContain('buttonClass("secondary")');
    expect(today).toContain('from "@/components/ui"');
  });

  it("the shared button really is 44px with a visible focus ring", () => {
    const ui = read("src/components/ui/index.tsx");
    expect(ui).toMatch(/min-h-\[44px\]/);
    expect(ui).toMatch(/focus-visible:ring-2/);
  });

  it("every chip row on Today meets 44px", () => {
    // Chips were py-1.5 (~30px). Any remaining short chip is a regression.
    const chipLines = today
      .split(/\r?\n/)
      .filter((l) => l.includes("rounded-full") && l.includes("border"));
    expect(chipLines.length).toBeGreaterThan(0);
    for (const line of chipLines) {
      const isInteractive = !line.includes("bg-[#DCFCE7]") && !line.includes("bg-[#FAF7F2]");
      if (!isInteractive) continue;
      expect(line, `chip below 44px: ${line.trim().slice(0, 80)}`).toMatch(
        /min-h-\[44px\]/
      );
    }
  });

  it("inline Undo and Reload controls are tappable, not just clickable", () => {
    const undo = today.slice(today.indexOf("Undo\n"), today.indexOf("Undo\n") + 40);
    void undo;
    // Both controls sat inside text with no height of their own.
    expect(today).toMatch(/min-h-\[44px\] shrink-0 items-center px-2 font-medium/);
    expect(today).toMatch(/min-h-\[44px\] shrink-0 items-center rounded-xl/);
  });

  it("the mobile nav still reserves its own 44px and the shell clears it", () => {
    expect(read("src/components/layout/app-nav.tsx")).toMatch(/min-h-\[44px\]/);
    // pb-24 keeps content above the fixed bottom nav on mobile.
    expect(read("src/app/(app)/layout.tsx")).toMatch(/pb-24/);
  });
});

describe("shared primitives are used, not re-invented per route", () => {
  it("the empty state and callout on Today come from the primitive layer", () => {
    const page = read("src/app/(app)/today/page.tsx");
    expect(page).toContain("EmptyState");
    expect(page).toContain("Callout");
    expect(page).toContain("ButtonLink");
  });

  it("the primitive layer stays framework-free and unbranded", () => {
    const ui = read("src/components/ui/index.tsx");
    // No new UI framework, no motion library — the constraint from the prompt.
    expect(ui).not.toMatch(/framer-motion|@radix-ui|@headlessui|shadcn/);
  });

  it("the Callout announces errors assertively and everything else politely", () => {
    const ui = read("src/components/ui/index.tsx");
    expect(ui).toMatch(/tone === "error" \? "alert" : "status"/);
    expect(ui).toMatch(/tone === "error" \? "assertive" : "polite"/);
  });
});

describe("performance work does not move sensitive logic to the client", () => {
  it("Today's page stays a server component", () => {
    const page = read("src/app/(app)/today/page.tsx");
    expect(page).not.toMatch(/^"use client"/m);
  });

  it("entitlement and safety gating are still read server-side", () => {
    const page = read("src/app/(app)/today/page.tsx");
    // The eating-disorder suppression of macro estimates must never become a
    // client-side check that a devtools user can flip.
    expect(page).toContain("safety_events");
    expect(page).toContain("showMacros = false");
  });
});
