import { describe, expect, it } from "vitest";
import {
  verifyEmail,
  welcomeEmail,
  sampleReadyEmail,
  trialStartedEmail,
  trialEndingEmail,
  trialEndedEmail,
  canceledEmail,
  paymentFailedEmail,
  type Email,
} from "@/lib/email/templates";
import { formatMoney, formatDate } from "@/lib/email/billing-facts";

/**
 * Lifecycle email regression (Content Elevation v6, Prompt 17).
 * Precise, premium, non-sensitive: no emoji in subjects, no wellbeing content,
 * exact billing facts when known, accessible buttons and a preheader.
 */

const EMOJI = /\p{Extended_Pictographic}/u;
const SENSITIVE = /\b(mood|stress|meal|meals|allerg|journal)\b/i;

const ALL: Email[] = [
  verifyEmail("https://mellowa.app/auth/callback?code=x"),
  welcomeEmail(),
  sampleReadyEmail(),
  trialStartedEmail(),
  trialEndingEmail(),
  trialEndedEmail(),
  canceledEmail(),
  paymentFailedEmail(),
];

describe("lifecycle emails (CE-17)", () => {
  it("uses the canonical, emoji-free transactional subjects", () => {
    // MW-V10-02: the subject states the length Stripe actually granted, so a
    // cohort never receives the other arm's number. With no length known the
    // copy stays length-neutral rather than guessing one.
    expect(trialStartedEmail({}, 3).subject).toBe(
      "Your 3-day Mellowa trial has started."
    );
    expect(trialStartedEmail({}, 7).subject).toBe(
      "Your 7-day Mellowa trial has started."
    );
    expect(trialStartedEmail().subject).toBe(
      "Your Mellowa trial has started."
    );
    expect(canceledEmail().subject).toBe("Your Mellowa plan is canceled");
    for (const e of ALL) expect(e.subject, e.subject).not.toMatch(EMOJI);
  });

  it("trial-ending subject names the real day, not a hard-coded 'tomorrow'", () => {
    // MW-V11: the daily cron catches trials ending within 48h, so the subject
    // must reflect how far off the end actually is — an email that says
    // "tomorrow" the day the trial already ended is exactly the bug this fixes.
    expect(trialEndingEmail({}, 0).subject).toBe("Your Mellowa trial ends today");
    expect(trialEndingEmail({}, 1).subject).toBe("Your Mellowa trial ends tomorrow");
    expect(trialEndingEmail({}, 2).subject).toBe("Your Mellowa trial ends in 2 days");
    // A past/negative value never claims a future day.
    expect(trialEndingEmail({}, -1).subject).toBe("Your Mellowa trial ends today");
    // Length-neutral fallback when the caller has no day count.
    expect(trialEndingEmail().subject).toBe("Your Mellowa trial ends soon");
  });

  it("never includes sensitive wellbeing details", () => {
    for (const e of ALL) {
      // strip the fixed safety footer, which legitimately mentions wellbeing
      const body = e.html.split("Mellowa is a wellbeing app")[0];
      expect(body, e.subject).not.toMatch(SENSITIVE);
    }
  });

  it("renders exact billing facts when provided, and a truthful fallback otherwise", () => {
    const exact = trialStartedEmail({
      plan: "Monthly plan",
      price: "€6.99",
      date: "17 August 2026",
    });
    expect(exact.html).toContain(
      "You'll be charged €6.99 on 17 August 2026 unless you cancel before then."
    );
    expect(trialStartedEmail().html).toContain(
      "Your exact price and date are on the billing page."
    );
  });

  it("uses state-aware deep links", () => {
    expect(welcomeEmail().html).toContain("/onboarding");
    expect(sampleReadyEmail().html).toContain("/today");
    expect(trialStartedEmail().html).toContain("/today");
    expect(trialStartedEmail().html).toContain("/billing");
    expect(canceledEmail().html).toContain("/billing");
    expect(paymentFailedEmail().html).toContain("/billing");
  });

  it("has accessible buttons and a preheader", () => {
    for (const e of ALL) {
      expect(e.html).toContain('role="button"');
      expect(e.html).toContain("visibility:hidden"); // preheader span
    }
  });
});

describe("billing facts formatting (CE-17)", () => {
  it("formats money and dates, and is safe on missing input", () => {
    expect(formatMoney(699, "eur")).toContain("6.99");
    expect(formatMoney(null, "eur")).toBeUndefined();
    expect(formatMoney(699, undefined)).toBeUndefined();
    expect(formatDate(1_755_388_800)).toMatch(/2025|2026/);
    expect(formatDate(undefined)).toBeUndefined();
  });
});
