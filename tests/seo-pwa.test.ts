import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { canonical, PRIVATE_PREFIXES, PUBLIC_ROUTES, SITE_URL } from "@/lib/seo/site";

/** SEO/social/PWA quality (Launch v6, Prompt 23). */

describe("robots", () => {
  const r = robots();

  it("disallows every private/api prefix and points at the sitemap", () => {
    const disallow = ([] as string[]).concat(
      (r.rules as { disallow?: string | string[] }).disallow ?? []
    );
    for (const prefix of PRIVATE_PREFIXES) {
      expect(disallow, `robots must disallow ${prefix}`).toContain(prefix);
    }
    expect(r.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
  });

  it("does not disallow the public marketing root", () => {
    expect((r.rules as { allow?: string }).allow).toBe("/");
  });
});

describe("sitemap", () => {
  const entries = sitemap();

  it("lists only public routes with absolute canonical URLs", () => {
    const urls = entries.map((e) => e.url).sort();
    expect(urls).toEqual(PUBLIC_ROUTES.map((r) => canonical(r)).sort());
    for (const e of entries) expect(e.url.startsWith("https://")).toBe(true);
  });

  it("never lists an authenticated or api route", () => {
    for (const e of entries) {
      for (const prefix of PRIVATE_PREFIXES) {
        expect(e.url.includes(prefix)).toBe(false);
      }
    }
  });
});

describe("metadata + social", () => {
  it("root layout sets metadataBase, OpenGraph and Twitter card", () => {
    const src = readFileSync("src/app/layout.tsx", "utf8");
    expect(src).toContain("metadataBase");
    expect(src).toContain("openGraph");
    expect(src).toContain('card: "summary_large_image"');
  });

  it("root metadata leads with the adaptive-day wedge, not the generic planner line (MW-P1-08)", () => {
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    const manifest = readFileSync("src/app/manifest.ts", "utf8");
    // The retired generic positioning must not return in root metadata or the PWA manifest.
    expect(layout).not.toContain("A simple daily plan for food, energy, mood and habits");
    expect(manifest).not.toContain("A simple daily plan for food, energy, mood and habits");
    // The wedge is present.
    expect(layout).toMatch(/reshape what|when your day changes/i);
    expect(manifest).toMatch(/reshape what|when your day changes/i);
    // The safety boundary is stated once, as a disclaimer — not a medical claim.
    expect(layout).toMatch(/not medical care/i);
    expect(layout).not.toMatch(/\b(cure|treats?|diagnos\w+)\s+(your|anxiety|depression|disease)/i);
  });

  it("branded OG image is 1200x630 and carries no fabricated stats", () => {
    const src = readFileSync("src/app/opengraph-image.tsx", "utf8");
    expect(src).toContain("width: 1200, height: 630");
    expect(src).not.toMatch(/\b\d[\d,]{3,}\s+(users|people)\b/i);
    expect(src).not.toMatch(/★|\b\d(\.\d)?\/5\b/);
  });

  it("landing exposes SoftwareApplication + FAQ JSON-LD without ratings", () => {
    const src = readFileSync("src/app/page.tsx", "utf8");
    expect(src).toContain("application/ld+json");
    expect(src).toContain("SoftwareApplication");
    expect(src).toContain("FAQPage");
    // No aggregateRating / review — we have no genuine reviews yet.
    expect(src).not.toContain("aggregateRating");
    expect(src).not.toContain("reviewRating");
  });
});

describe("private surfaces are non-indexable", () => {
  it("the authenticated app layout sets robots noindex", () => {
    const src = readFileSync("src/app/(app)/layout.tsx", "utf8");
    expect(src).toContain("robots: { index: false");
  });

  it("admin surfaces set robots noindex", () => {
    expect(readFileSync("src/app/admin/page.tsx", "utf8")).toContain("index: false");
    expect(readFileSync("src/app/admin/users/page.tsx", "utf8")).toContain("index: false");
  });
});

describe("no service worker can leak a session", () => {
  it("ships no custom service worker with caching logic", () => {
    // A manifest is fine; a caching SW is not (Prompt 23 acceptance criterion).
    // Guard against a future sw.js or serviceWorker.register slipping in.
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    expect(layout).not.toContain("serviceWorker.register");
  });
});
