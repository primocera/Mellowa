import { readFileSync, statSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * MW-V9-09: PWA assets, manifest correctness and the shared UI pattern layer.
 * These close the go/no-go item for real binary 192/512 PNG icons and lock in
 * the accessible primitives used across critical flows.
 */

describe("PWA icons are real binary PNGs", () => {
  const files = [
    "public/icon-192.png",
    "public/icon-512.png",
    "public/icon-maskable-512.png",
    "public/apple-touch-icon.png",
  ];

  it("all required icon files exist and are non-trivial binaries", () => {
    for (const f of files) {
      expect(existsSync(f), `${f} missing`).toBe(true);
      // A real rasterized icon is well over 1KB; a stub/placeholder would not be.
      expect(statSync(f).size).toBeGreaterThan(1024);
    }
  });

  it("files carry the PNG magic header", () => {
    for (const f of files) {
      const buf = readFileSync(f);
      expect(buf[0]).toBe(0x89);
      expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
    }
  });
});

describe("manifest references the PNG icon set", () => {
  const manifest = readFileSync("src/app/manifest.ts", "utf8");

  it("lists 192 and 512 PNG icons plus a maskable entry", () => {
    expect(manifest).toContain('"/icon-192.png"');
    expect(manifest).toContain('"192x192"');
    expect(manifest).toContain('"/icon-512.png"');
    expect(manifest).toContain('"512x512"');
    expect(manifest).toContain('"/icon-maskable-512.png"');
    expect(manifest).toContain('purpose: "maskable"');
    expect(manifest).toContain('theme_color: "#7C9A92"');
  });
});

describe("layout declares apple touch icon and theme color", () => {
  const layout = readFileSync("src/app/layout.tsx", "utf8");

  it("wires the apple touch icon, manifest and appleWebApp", () => {
    expect(layout).toContain("apple-touch-icon.png");
    expect(layout).toContain("manifest:");
    expect(layout).toContain("appleWebApp");
  });

  it("exposes a theme-color viewport matching the brand", () => {
    expect(layout).toContain("export const viewport");
    expect(layout).toContain('themeColor: "#7C9A92"');
  });
});

describe("shared UI pattern layer is accessible", () => {
  const ui = readFileSync("src/components/ui/index.tsx", "utf8");

  it("buttons meet the 44px target and show a visible focus ring", () => {
    expect(ui).toContain("min-h-[44px]");
    expect(ui).toContain("focus-visible:ring-2");
  });

  it("has the four button variants and callout tones", () => {
    for (const v of ["primary", "secondary", "quiet", "destructive"]) {
      expect(ui).toContain(v);
    }
    // Errors announce assertively; other statuses politely.
    expect(ui).toContain('role={tone === "error" ? "alert" : "status"}');
  });

  it("skeleton honors reduced motion", () => {
    expect(ui).toContain("motion-reduce:animate-none");
  });
});

describe("route error boundary recovers without a blank page", () => {
  const err = readFileSync("src/app/(app)/error.tsx", "utf8");

  it("offers retry and reassures that data is safe", () => {
    expect(err).toContain("reset");
    expect(err).toMatch(/Try again/i);
    expect(err).toMatch(/saved plans and data are safe/i);
  });

  it("never logs the error message/stack client-side (digest only)", () => {
    expect(err).toContain("digest: error.digest");
    expect(err).not.toMatch(/console\.[a-z]+\([^)]*error\.message/);
    expect(err).not.toMatch(/console\.[a-z]+\([^)]*error\.stack/);
  });
});
