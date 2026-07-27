import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TERMS } from "@/lib/content/terminology";

/** Landing/pricing conversion (Launch v6, Prompt 20). */

const landing = readFileSync("src/app/page.tsx", "utf8");
const pricing = readFileSync("src/app/pricing/page.tsx", "utf8");

/**
 * Prose in JSX wraps across source lines, so a sentence that renders as one
 * phrase spans several lines in the file. Collapse whitespace before matching a
 * sentence, or the assertion is really about where the formatter broke a line.
 */
const landingFlat = landing.replace(/\s+/g, " ");

describe("hero communicates audience, outcome, mechanism, next step", () => {
  it("uses the exact required headline, CTA and helper", () => {
    expect(TERMS.promise).toBe(
      "A realistic wellbeing plan for the day you actually have."
    );
    // Headline renders the canonical promise; CTA + helper come from TERMS.
    // MW-V11-01: the promise is composed via joinSentences rather than
    // interpolated beside prose, because the adjacent form lost its space.
    expect(landing).toMatch(/joinSentences\(\s*TERMS\.promise/);
    expect(landing).toContain("{TERMS.sampleCta}");
    expect(TERMS.sampleCta).toBe("Create my free sample plan");
    // The helper now states both facts once: account required, no card asked.
    expect(TERMS.sampleHelper).toContain("no payment card");
    expect(TERMS.sampleHelper).toContain("account is required");
  });

  it("clarifies who it is for and who it is not for", () => {
    expect(landing).toContain("Who it");
    expect(landing).toMatch(/not medical care|isn.t medical care/i);
  });

  it("explains personalization and what the AI does", () => {
    expect(landing).toContain("How personalization works");
    expect(landing).toContain("What the AI does");
    expect(landing).toMatch(/safety-check/i);
  });
});

describe("MW-01: exact plan output categories and honest boundaries", () => {
  it("lists every contract output category", () => {
    for (const category of [
      "meal rhythm",
      "Hydration cues",
      "Optional movement",
      "One calm reset",
      "evening wind-down",
      "small habit with a minimum version",
    ]) {
      expect(landing).toContain(category);
    }
  });

  it("states the sample is a one-time sample without a payment method", () => {
    expect(landing).toMatch(/one-time sample per account/i);
    expect(landing).toMatch(/No payment method is required/i);
  });

  it("makes no absolute check-in-time claim", () => {
    // Time claims must be qualified (core check-in) since optional detail
    // changes duration.
    expect(landing).not.toMatch(/one minute to check in/i);
    expect(landing).toMatch(/core check-in/i);
  });

  it("answers professional-support and trial FAQ questions", () => {
    expect(landing).toMatch(/doctor, dietitian or therapist/i);
    expect(landing).toMatch(/When does the trial begin\?/);
  });

  it("renders prices from the canonical Stripe plan configuration", () => {
    expect(landing).toContain('import { PRICING } from "@/lib/stripe/plans"');
    expect(landing).toContain("{PRICING.monthly.price}");
    expect(landing).toContain("{PRICING.yearly.price}");
    // No hardcoded plan-price literals left in JSX outside derived math copy.
    expect(landing).not.toMatch(/€9\.99<span/);
    expect(landing).not.toMatch(/€59\.99<span/);
  });
});

describe("honest, evidence-based claims", () => {
  it("makes the annual saving mathematically explicit on both surfaces", () => {
    expect(landing).toContain("€119.88");
    expect(landing).toContain("€59.89");
    expect(pricing).toContain("€119.88");
  });

  it("keeps payment/renewal disclosure next to the CTA", () => {
    expect(landingFlat).toMatch(/renews automatically unless you cancel/i);
  });

  it("contains no fabricated testimonials or usage numbers", () => {
    // No "join N users", "N,000 people", star-rating or quoted testimonial blocks.
    expect(landing).not.toMatch(/\b\d[\d,]{3,}\s+(users|people|members|customers)\b/i);
    expect(landing).not.toMatch(/join \d/i);
    expect(landing).not.toMatch(/★|⭐|\b\d(\.\d)?\/5\b/);
  });
});

describe("MW-V9-08 wedge, mechanism and Premium jobs", () => {
  it("names the wedge — days without a consistent routine, fewer decisions", () => {
    expect(landing).toMatch(/follow a routine/i);
    expect(landing).toContain("Fewer decisions");
  });

  it("shows the loop above the fold, including what survives an adjustment", () => {
    // MW-V10-01 replaced the four-beat cards further down the page with a
    // five-beat strip in the hero. The two extra beats are the wedge itself:
    // adjusting does not erase completed work, and it is reversible.
    //
    // MW-V11-03 split them into a three-beat flow and a two-item trust subrow.
    // As one five-item row it wrapped wherever the viewport broke, stranding
    // "Undo is free" on a line of its own. All five statements are still above
    // the fold; only the composition changed.
    for (const beat of [
      "Check in",
      "See one next step",
      "Adjust what's left",
      "Completed items stay",
      "Undo is free",
    ]) {
      expect(landing).toContain(beat);
    }
  });

  it("frames Premium as the three ongoing jobs", () => {
    expect(landing).toContain("Adapt today");
    expect(landing).toContain("Reuse what works");
    expect(landing).toContain("Carry it into next week");
  });

  it("does not imply the free sample includes a Premium whole-day repair", () => {
    // The sample is explicitly one day; the ongoing loop (which includes
    // whole-day "adjust the rest") is named as Premium.
    expect(landing).toContain("The free sample is one day. Premium is the ongoing loop");
    expect(landing).toContain("What Premium keeps doing");
  });

  it("makes no banned pressure or outcome claims", () => {
    expect(landing).not.toMatch(/unlimited/i);
    expect(landing).not.toMatch(/transform your life|\banxiety\b|\bcure\b|guaranteed/i);
  });
});

describe("MW-V9-08 yearly emphasis is opt-in (default off)", () => {
  const flags = readFileSync("src/lib/flags.ts", "utf8");

  it("the emphasis flag defaults OFF — no aggressive yearly default", () => {
    // Inverse of the kill-switch flags: this one is only on when explicitly set.
    expect(flags).toContain("isYearlyEmphasisEnabled");
    expect(flags).toContain("FLAG_EMPHASIZE_YEARLY");
    expect(flags).toMatch(/raw === "1" \|\| raw\?\.toLowerCase\(\) === "true"/);
  });

  it("pricing reads the flag and emphasizes Monthly by default", () => {
    expect(pricing).toContain("isYearlyEmphasisEnabled");
    expect(pricing).toContain("emphasizeYearly");
    // Monthly keeps the accent border unless the flag flips it.
    expect(pricing).toMatch(/emphasizeYearly\s*\n?\s*\?\s*"rounded-2xl bg-white/);
  });
});

describe("privacy-safe CTA instrumentation", () => {
  it("primary CTAs are tracked with landing_cta_clicked", () => {
    expect(landing).toContain("TrackedCta");
    expect(landing).toContain('event="landing_cta_clicked"');
    // Both plan CTAs carry the interval so conversion can be split.
    expect(landing).toContain('planInterval="monthly"');
    expect(landing).toContain('planInterval="yearly"');
  });

  it("client beacon only sends enumerated properties", () => {
    const client = readFileSync("src/lib/analytics/client.ts", "utf8");
    // No plan/journal/mood content — the endpoint re-validates, but the helper
    // must not shovel arbitrary objects either.
    expect(client).toContain("/api/events");
    expect(client).toMatch(/Record<string, string>/);
  });
});
