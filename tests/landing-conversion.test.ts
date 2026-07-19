import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TERMS } from "@/lib/content/terminology";

/** Landing/pricing conversion (Launch v6, Prompt 20). */

const landing = readFileSync("src/app/page.tsx", "utf8");
const pricing = readFileSync("src/app/pricing/page.tsx", "utf8");

describe("hero communicates audience, outcome, mechanism, next step", () => {
  it("uses the exact required headline, CTA and helper", () => {
    expect(TERMS.promise).toBe(
      "A realistic wellbeing plan for the day you actually have."
    );
    // Headline renders the canonical promise; CTA + helper come from TERMS.
    expect(landing).toContain("{TERMS.promise}");
    expect(landing).toContain("{TERMS.sampleCta}");
    expect(TERMS.sampleCta).toBe("Create my free sample plan");
    expect(TERMS.sampleHelper).toContain("No card for the sample");
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
    expect(landing).toMatch(/renews automatically unless you cancel/i);
  });

  it("contains no fabricated testimonials or usage numbers", () => {
    // No "join N users", "N,000 people", star-rating or quoted testimonial blocks.
    expect(landing).not.toMatch(/\b\d[\d,]{3,}\s+(users|people|members|customers)\b/i);
    expect(landing).not.toMatch(/join \d/i);
    expect(landing).not.toMatch(/★|⭐|\b\d(\.\d)?\/5\b/);
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
