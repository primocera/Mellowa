import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  errorCopy,
  LOADING_COPY,
  SUCCESS_COPY,
  type PublicErrorCode,
} from "@/lib/microcopy/errors";

/**
 * System microcopy regression (Content Elevation v6, Prompt 15).
 * One typed source of truth; every recoverable error preserves effort and
 * offers one action; no raw provider strings; no fake progress percentages.
 */

const ALL_CODES: PublicErrorCode[] = [
  "generic",
  "plan_provider_failure",
  "capacity",
  "rate_limit",
  "offline",
  "save_failed",
  "session_expired",
  "onboarding_required",
  "allergen_validation",
  "delete_blocked",
  "email_resend",
  "empty_list",
];

describe("system microcopy (CE-15)", () => {
  it("carries the canonical provider-failure and save-failure copy", () => {
    expect(errorCopy("plan_provider_failure")).toBe(
      "Mellowa couldn't shape a new plan just now. Your check-in is saved. Try again in a few minutes."
    );
    expect(errorCopy("save_failed")).toBe(
      "This change wasn't saved. Try once more."
    );
  });

  it("substitutes an approximate time and falls back grammatically", () => {
    expect(errorCopy("capacity", { time: "about 10 minutes" })).toContain(
      "Try again in about 10 minutes."
    );
    // No fake number when the caller does not know one.
    expect(errorCopy("capacity")).toContain("Try again in a few minutes.");
    expect(errorCopy("capacity")).not.toContain("{time}");
    expect(errorCopy("rate_limit")).toContain("in a little while");
  });

  it("never leaks raw provider vocabulary", () => {
    for (const code of ALL_CODES) {
      const copy = errorCopy(code).toLowerCase();
      for (const banned of ["supabase", "stripe", "postgres", "sql", "undefined", "null", "500"]) {
        expect(copy, `${code} leaks ${banned}`).not.toContain(banned);
      }
    }
  });

  it("uses present-progressive loading and plain success, no percentages", () => {
    for (const v of Object.values(LOADING_COPY)) expect(v).toMatch(/…$/);
    for (const v of Object.values(SUCCESS_COPY)) expect(v).not.toMatch(/%/);
    expect(SUCCESS_COPY.daily_plan).toBe("Today's plan is ready.");
  });

  it("is wired into generation surfaces instead of ad-hoc strings", () => {
    const weekly = readFileSync(
      "src/components/dailyflow/weekly-plan-view.tsx",
      "utf8"
    );
    expect(weekly).toContain('from "@/lib/microcopy/errors"');
    expect(weekly).not.toContain(
      "Couldn't create the plan right now — try again in a moment."
    );
  });
});
