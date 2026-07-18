import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MESSAGES,
  LOCALIZATION_LOCKED,
  message,
  isCta,
  isLocked,
  type MessageId,
} from "@/lib/i18n/messages";

/**
 * Localization-readiness & CTA accessibility (Content Elevation v6, Prompt 19).
 * Stable IDs, explicit-verb CTAs, locked safety/legal copy, and an inventory
 * that stays in sync with what the app actually renders.
 */

const IDS = Object.keys(MESSAGES) as MessageId[];

// Explicit action verbs that a screen reader can announce out of context.
const VERB = /^(Shape|Make|Create|Update|Confirm|Download|Delete|Email|Give|Open|Manage|Set|See|Build|Check)\b/;

describe("localization readiness (CE-19)", () => {
  it("has unique, namespaced, non-empty IDs", () => {
    for (const id of IDS) {
      expect(MESSAGES[id].id).toBe(id);
      expect(id).toMatch(/^[a-z]+\.[a-zA-Z.]+$/);
      expect(message(id).trim().length).toBeGreaterThan(0);
    }
    expect(new Set(IDS).size).toBe(IDS.length);
  });

  it("every CTA names its action with an explicit verb", () => {
    for (const id of IDS) {
      if (isCta(id)) {
        expect(message(id), id).toMatch(VERB);
      }
    }
  });

  it("locks safety and legal copy from machine translation", () => {
    expect(LOCALIZATION_LOCKED).toContain("safety.crisis.opening");
    expect(LOCALIZATION_LOCKED).toContain("boundary.notMedical");
    for (const id of LOCALIZATION_LOCKED) {
      expect(isLocked(id)).toBe(true);
      expect(isCta(id)).toBe(false);
    }
  });

  it("keeps the CTA inventory in sync with rendered copy", () => {
    const sources = [
      "src/components/dailyflow/checkin-form.tsx",
      "src/components/dailyflow/weekly-plan-view.tsx",
      "src/components/dailyflow/meal-rhythm-view.tsx",
      "src/components/dailyflow/account-data-controls.tsx",
    ]
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");

    for (const id of ["checkin.cta.shape", "week.cta.shape", "meals.cta.create", "data.cta.delete"] as MessageId[]) {
      expect(sources, id).toContain(message(id));
    }
  });
});
