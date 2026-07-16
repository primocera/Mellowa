import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BANNED_PROGRESS_PHRASES,
  metricTextSummary,
} from "@/lib/progress/neutral";

/** Strip // and /* *​/ comments so our own explanatory notes aren't scanned. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("neutral progress (Prompt 15)", () => {
  it("summarises a metric with self-reported range and sample size", () => {
    expect(
      metricTextSummary({ label: "Energy", values: [3, 5, null, 4] })
    ).toBe("Energy: self-reported 3 to 5 out of 5, across 3 check-ins.");
    expect(metricTextSummary({ label: "Mood", values: [null] })).toBe(
      "Mood: no check-ins recorded yet."
    );
    expect(metricTextSummary({ label: "Sleep", values: [4] })).toBe(
      "Sleep: self-reported 4 out of 5, across 1 check-in."
    );
  });

  it("the Progress page contains no causal, clinical or pressure language", () => {
    const src = stripComments(
      readFileSync(
        join(__dirname, "..", "src", "app", "(app)", "progress", "page.tsx"),
        "utf8"
      )
    ).toLowerCase();
    for (const phrase of BANNED_PROGRESS_PHRASES) {
      expect(src, `must not contain "${phrase}"`).not.toContain(phrase);
    }
  });

  it("the chart exposes an accessible text alternative", () => {
    const src = readFileSync(
      join(__dirname, "..", "src", "app", "(app)", "progress", "page.tsx"),
      "utf8"
    );
    expect(src).toMatch(/role="img"/);
    expect(src).toMatch(/aria-label=\{summary\}/);
  });
});
