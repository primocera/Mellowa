import { describe, expect, it } from "vitest";
import {
  parsePlanIntent,
  resolveDestination,
  sanitizeNextPath,
  serializeIntent,
} from "@/lib/auth/intent";

describe("sanitizeNextPath", () => {
  it("accepts allow-listed relative paths", () => {
    expect(sanitizeNextPath("/dashboard")).toBe("/dashboard");
    expect(sanitizeNextPath("/onboarding")).toBe("/onboarding");
    expect(sanitizeNextPath("/pricing?plan=monthly")).toBe("/pricing?plan=monthly");
    expect(sanitizeNextPath("/billing/manage")).toBe("/billing/manage");
  });

  it("rejects absolute and protocol-relative URLs", () => {
    expect(sanitizeNextPath("https://evil.com/dashboard")).toBeNull();
    expect(sanitizeNextPath("//evil.com")).toBeNull();
    expect(sanitizeNextPath("http://evil.com")).toBeNull();
    expect(sanitizeNextPath("/dashboard://evil")).toBeNull();
  });

  it("rejects backslash tricks and unknown paths", () => {
    expect(sanitizeNextPath("/\\evil.com")).toBeNull();
    expect(sanitizeNextPath("/dashboard\\..")).toBeNull();
    expect(sanitizeNextPath("/admin")).toBeNull();
    expect(sanitizeNextPath("/todayish")).toBeNull();
    expect(sanitizeNextPath("javascript:alert(1)")).toBeNull();
    expect(sanitizeNextPath("")).toBeNull();
    expect(sanitizeNextPath(null)).toBeNull();
  });

  it("strips fragments but keeps queries", () => {
    expect(sanitizeNextPath("/today#section")).toBe("/today");
    expect(sanitizeNextPath("/pricing?plan=yearly#x")).toBe("/pricing?plan=yearly");
  });
});

describe("parsePlanIntent", () => {
  it("accepts only monthly/yearly", () => {
    expect(parsePlanIntent("monthly")).toBe("monthly");
    expect(parsePlanIntent("yearly")).toBe("yearly");
    expect(parsePlanIntent("weekly")).toBeNull();
    expect(parsePlanIntent(null)).toBeNull();
  });
});

describe("serializeIntent", () => {
  it("round-trips plan and next", () => {
    expect(serializeIntent({ plan: "monthly", next: "/onboarding" })).toBe(
      "?plan=monthly&next=%2Fonboarding"
    );
    expect(serializeIntent({})).toBe("");
  });

  it("drops unsafe next values", () => {
    expect(serializeIntent({ next: "https://evil.com" })).toBe("");
  });
});

describe("resolveDestination", () => {
  it("prefers a safe next path", () => {
    expect(resolveDestination({ plan: "monthly", next: "/today" })).toBe("/today");
  });
  it("falls back to pricing with a plan intent", () => {
    expect(resolveDestination({ plan: "yearly" })).toBe("/pricing?plan=yearly");
  });
  it("defaults to /dashboard", () => {
    expect(resolveDestination({})).toBe("/dashboard");
    expect(resolveDestination({ next: "//evil.com" })).toBe("/dashboard");
  });
});
