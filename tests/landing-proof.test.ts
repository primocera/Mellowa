import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * MW-V11-03: claim-to-behaviour audit for the landing proof.
 *
 * The landing page now *shows* the adaptation loop rather than describing it.
 * That is a stronger claim than prose, and it decays in a specific way: someone
 * renames a label in the product, the marketing illustration keeps the old one,
 * and the page quietly starts advertising a screen that no longer exists.
 *
 * So every user-visible string in the proof is checked against the component
 * that actually renders it. If `today-plan-v2.tsx` stops saying "Already done —
 * kept", this fails.
 */

const proof = readFileSync("src/components/dailyflow/adaptive-day-proof.tsx", "utf8");
const today = readFileSync("src/components/dailyflow/today-plan-v2.tsx", "utf8");
const landing = readFileSync("src/app/page.tsx", "utf8");

/**
 * Prose in JSX wraps across source lines, so a sentence that renders as one
 * phrase is several lines in the file. Collapse runs of whitespace before
 * matching sentences, or every assertion here silently depends on where the
 * formatter chose to break the line.
 */
const flat = (source: string) => source.replace(/\s+/g, " ");
const proofFlat = flat(proof);
const landingFlat = flat(landing);

/** Strings the proof shows that the product must really render. */
const PRODUCT_LABELS = [
  "What will change",
  "Can change",
  "Already done",
  "Already done — kept",
  "Kept — won&rsquo;t change",
  "Rest of today adjusted",
  "Undo — bring the previous plan back",
  "Done for now",
  "Not now",
  "Less time",
  "Lower energy",
];

describe("the proof shows labels the product actually renders", () => {
  it.each(PRODUCT_LABELS)("Today renders %s", (label) => {
    // The proof writes the typographic apostrophe as an entity; the component
    // writes it the same way, but normalise so the comparison is about wording.
    const normalise = (s: string) => s.replace(/&rsquo;/g, "'").replace(/&apos;/g, "'");
    expect(normalise(proof), `proof does not show "${label}"`).toContain(normalise(label));
    expect(normalise(today), `today-plan-v2 no longer renders "${label}"`).toContain(
      normalise(label),
    );
  });

  it("uses the product's own counting vocabulary, not a marketing paraphrase", () => {
    // The three-way split is the actual mechanism: what a repair may replace,
    // what the user pinned, and what is already finished.
    for (const word of ["Can change", "Kept", "Already done"]) {
      expect(proof).toContain(word);
      expect(today).toContain(word);
    }
  });
});

describe("the proof is honest about what it is", () => {
  it("labels itself an example and denies being a customer result", () => {
    expect(proofFlat).toMatch(/example of the product view/i);
    expect(proofFlat).toMatch(/not a customer result/i);
    expect(proofFlat).toMatch(/sample data/i);
  });

  it("makes no outcome, testimonial or metric claim", () => {
    for (const pattern of [
      /\b\d+\s*%/, // "87% of users…"
      /users? (report|say|saw|lost|gained)/i,
      /testimonial/i,
      /average|typical result/i,
    ]) {
      expect(proof, `proof makes an unsupported claim (${pattern})`).not.toMatch(pattern);
    }
  });

  it("contains only synthetic fixture data, never a fetch", () => {
    // A landing illustration must not be able to read a real plan.
    expect(proof).not.toMatch(/fetch\(|createClient|supabase|await /);
    expect(proof).toMatch(/const BEFORE = \[/);
  });
});

describe("the proof is an illustration, not a fake product", () => {
  it("ships no interactive controls", () => {
    // Mock buttons that take focus and do nothing are worse for keyboard and
    // screen-reader users than an honest picture. The chips are spans.
    expect(proof).not.toMatch(/<button/);
    expect(proof).not.toMatch(/onClick/);
    expect(proof).not.toMatch(/href=/);
  });

  it("is a server component with no client state", () => {
    expect(proof).not.toContain('"use client"');
    expect(proof).not.toMatch(/useState|useEffect/);
  });

  it("is marked up as a figure with a caption", () => {
    expect(proof).toContain("<figure");
    expect(proof).toContain("<figcaption");
  });

  it("animates nothing, so there is nothing to suppress under reduced motion", () => {
    expect(proof).not.toMatch(/animate-|transition-all|duration-\d+|motion-safe/);
  });

  it("marks state with a border, not colour alone, for forced-colors mode", () => {
    // Each status chip carries a border so it survives a forced palette. The
    // "already done — kept" chip is subtle amber; the "kept" chip is sage-tinted.
    expect(proof).toMatch(/border border-\[#92400E\]\/20 bg-\[#FEF3C7\]/);
    expect(proof).toMatch(/border-\[#7C9A92\] bg-\[#7C9A92\]\/10/);
  });
});

describe("the landing page places the proof before the explanation", () => {
  it("carries the how-it-works anchor, because showing it is how it works", () => {
    expect(landing).toContain('id="how-it-works"');
    expect(landing).toContain("<AdaptiveDayProof />");
  });

  it("puts the proof ahead of the pricing offer", () => {
    expect(landing.indexOf("<AdaptiveDayProof />")).toBeLessThan(
      landing.indexOf("See one day before you choose a plan"),
    );
  });

  it("no longer runs a five-item hero flow that strands its last beat", () => {
    // The five-beat row wrapped wherever the viewport broke, leaving "Undo is
    // free" alone on a second line. Three beats, then a deliberate subrow.
    expect(landing).toContain('"Check in", "See one next step", "Adjust what\'s left"');
    expect(landing).not.toMatch(/"Completed items stay",\s*\n\s*"Undo is free",/);
  });

  it("every in-page anchor it links to actually exists", () => {
    // MW-V11-03 folded the separate sample-day section into the proof, so
    // `#sample-plan` is gone and the hero link now points at `#how-it-works`.
    // Rather than pin a list, derive it: any hash link must have a target.
    const linked = [...landing.matchAll(/href="#([\w-]+)"/g)].map((m) => m[1]);
    expect(linked.length).toBeGreaterThan(0);
    for (const anchor of new Set(linked)) {
      expect(landing, `#${anchor} is linked but no element has that id`).toContain(
        `id="${anchor}"`,
      );
    }
  });
});

describe("mandatory disclosures survived the copy reduction", () => {
  it("keeps the adult-only general-wellbeing boundary", () => {
    expect(landingFlat).toMatch(/general wellbeing/i);
    expect(landingFlat).toMatch(/not medical care|isn&rsquo;t medical care/i);
  });

  it("keeps the redirect to qualified help", () => {
    expect(landingFlat).toMatch(/qualified (help|professional)/i);
  });

  it("keeps the sample-versus-trial distinction and the price truth", () => {
    expect(landing).toContain("trialOfferSentence");
    expect(landing).toContain("PRICING.monthly.price");
    expect(landing).toContain("PRICING.yearly.price");
  });

  it("keeps the safety-check statement", () => {
    expect(landingFlat).toMatch(/safety-checked/i);
    expect(landingFlat).toMatch(/never diagnoses/i);
  });

  it("keeps the removable-learning control, stated once", () => {
    const mentions = landingFlat.match(/remove (anything|what) it learned/gi) ?? [];
    expect(mentions.length, "learning removal is stated more than once").toBe(1);
  });
});
