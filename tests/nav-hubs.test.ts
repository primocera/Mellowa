import { readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hubForPath, HUB_HREF, MAPPED_ROUTES, type Hub } from "@/lib/nav/hubs";
import { navEntitlement } from "@/lib/nav/entitlement";

/**
 * MW-95-04: the route → hub resolver is the ONE source of navigation active
 * state. Every authenticated detail route must resolve to exactly one hub, an
 * unknown route to none, and query/hash/trailing-slash must not change the
 * parent. A billing read that could not be verified must map to "unknown", never
 * "free".
 */

const APP = join(__dirname, "..", "src", "app", "(app)");

describe("hubForPath — table-driven route resolution", () => {
  const cases: Array<[string, Hub | null]> = [
    // Primary destinations
    ["/today", "today"],
    ["/plan", "week"],
    ["/library", "saved"],
    ["/you", "you"],
    // Today hub descendants
    ["/check-in", "today"],
    ["/dashboard", "today"],
    // Week hub descendants
    ["/weekly-plan", "week"],
    ["/meal-rhythm", "week"],
    // Saved hub descendants
    ["/favourites", "saved"],
    ["/movement", "saved"],
    ["/stress-reset", "saved"],
    // You hub descendants
    ["/progress", "you"],
    ["/journal", "you"],
    ["/habits", "you"],
    ["/billing", "you"],
    ["/settings", "you"],
    ["/help", "you"],
    // Deep links, query and hash do not change the parent
    ["/weekly-plan/2026-08-10", "week"],
    ["/billing?status=success", "you"],
    ["/plan#week-2", "week"],
    ["/today/", "today"],
    ["/meal-rhythm/breakfast?x=1#top", "week"],
    // A prefix must not swallow an unrelated sibling
    ["/plannable", null],
    // Unknown authenticated routes highlight NO hub
    ["/nonexistent", null],
    ["/onboarding", null],
    ["/", null],
  ];

  for (const [path, expected] of cases) {
    it(`${path} → ${expected ?? "none"}`, () => {
      expect(hubForPath(path)).toBe(expected);
    });
  }

  it("never resolves a path to more than one hub (map is a function)", () => {
    for (const route of MAPPED_ROUTES) {
      const hub = hubForPath(route);
      expect(hub, `${route} should resolve to a single hub`).not.toBeNull();
    }
  });

  it("every hub landing href resolves back to its own hub", () => {
    for (const [hub, href] of Object.entries(HUB_HREF) as [Hub, string][]) {
      expect(hubForPath(href)).toBe(hub);
    }
  });

  it("every real authenticated page route resolves to a hub (no orphan detail pages)", () => {
    // Directories under (app) that render a page and appear in the primary
    // navigation tree must have a canonical hub. Route groups, onboarding (a
    // pre-hub flow) and non-page dirs are excluded.
    const skip = new Set(["onboarding"]);
    const dirs = readdirSync(APP).filter((name) => {
      const full = join(APP, name);
      return (
        statSync(full).isDirectory() &&
        !name.startsWith("(") &&
        !skip.has(name) &&
        existsSync(join(full, "page.tsx"))
      );
    });
    for (const dir of dirs) {
      expect(hubForPath(`/${dir}`), `/${dir} has no canonical hub`).not.toBeNull();
    }
  });
});

describe("navEntitlement — a billing outage is never a free user", () => {
  it("maps every unavailable read to unknown regardless of status", () => {
    for (const status of ["none", "active", "trialing", "past_due", "canceled", ""]) {
      expect(navEntitlement(status, "unavailable")).toBe("unknown");
    }
  });

  it("maps a CONFIRMED non-entitled read to free", () => {
    expect(navEntitlement("none", "available")).toBe("free");
  });

  it("maps verified states to their coarse category", () => {
    expect(navEntitlement("trialing", "available")).toBe("trialing");
    expect(navEntitlement("active", "available")).toBe("premium");
    expect(navEntitlement("past_due", "available")).toBe("past_due");
    expect(navEntitlement("unpaid", "available")).toBe("past_due");
    expect(navEntitlement("canceled", "available")).toBe("canceled");
  });

  it("maps an unrecognized but 'available' status to unknown, not free", () => {
    expect(navEntitlement("some_future_status", "available")).toBe("unknown");
  });
});
