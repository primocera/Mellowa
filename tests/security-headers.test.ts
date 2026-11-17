import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import {
  contentSecurityPolicyDirectives,
  securityHeaders,
} from "@/lib/security/headers";

/**
 * Audit A1. Asserts on the header set Next is actually configured to send
 * (the real `headers()` from next.config.ts), not on source text.
 */

async function configured() {
  const rules = await nextConfig.headers!();
  expect(rules).toHaveLength(1);
  return rules[0];
}

const value = (headers: { key: string; value: string }[], key: string) =>
  headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;

describe("next.config.ts sends security headers on every route", () => {
  it("applies one rule to all paths", async () => {
    expect((await configured()).source).toBe("/(.*)");
  });

  it("enforces framing, sniffing and referrer protection", async () => {
    const { headers } = await configured();
    expect(value(headers, "X-Frame-Options")).toBe("DENY");
    expect(value(headers, "X-Content-Type-Options")).toBe("nosniff");
    expect(value(headers, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("ships the CSP report-only — nothing is enforced yet", async () => {
    const { headers } = await configured();
    expect(value(headers, "Content-Security-Policy-Report-Only")).toBeTruthy();
    expect(
      value(headers, "Content-Security-Policy"),
      "an enforcing CSP must be a deliberate, separately verified change",
    ).toBeUndefined();
  });

  it("Permissions-Policy keeps the camera available to our own origin only", async () => {
    const policy = value((await configured()).headers, "Permissions-Policy")!;
    const features = policy.split(",").map((f) => f.trim());
    expect(features).toContain("camera=(self)");
    expect(features, "camera must not be disabled outright").not.toContain("camera=()");
    expect(features).toContain("microphone=()");
    expect(features).toContain("geolocation=()");
  });
});

describe("content security policy", () => {
  const prod = contentSecurityPolicyDirectives({
    supabaseUrl: "https://abc.supabase.co/",
  });

  it("allows blob: images and media (data export today, camera previews later)", () => {
    expect(prod["img-src"]).toContain("blob:");
    expect(prod["media-src"]).toContain("blob:");
  });

  it("lets the browser reach Supabase over https and wss, and nothing else cross-origin", () => {
    expect(prod["connect-src"]).toEqual([
      "'self'",
      "https://abc.supabase.co",
      "wss://abc.supabase.co",
    ]);
  });

  it("locks down frames, plugins and base-uri", () => {
    expect(prod["frame-ancestors"]).toEqual(["'none'"]);
    expect(prod["object-src"]).toEqual(["'none'"]);
    expect(prod["base-uri"]).toEqual(["'self'"]);
  });

  it("only allows eval in development", () => {
    expect(prod["script-src"]).not.toContain("'unsafe-eval'");
    expect(contentSecurityPolicyDirectives({ isDev: true })["script-src"]).toContain(
      "'unsafe-eval'",
    );
  });

  it("a missing or malformed Supabase URL degrades to 'self', never throws", () => {
    expect(contentSecurityPolicyDirectives({})["connect-src"]).toEqual(["'self'"]);
    expect(contentSecurityPolicyDirectives({ supabaseUrl: "not a url" })["connect-src"]).toEqual([
      "'self'",
    ]);
  });

  it("serializes to a single-line header value", () => {
    const csp = value(securityHeaders({ supabaseUrl: "https://abc.supabase.co" }),
      "Content-Security-Policy-Report-Only")!;
    expect(csp).not.toMatch(/[\r\n]/);
    expect(csp).toContain("default-src 'self'; ");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
