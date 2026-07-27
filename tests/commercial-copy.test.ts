import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TERMS, joinSentences } from "@/lib/content/terminology";
import {
  publicTrialDays,
  startTrialCta,
  trialLengthAdjective,
  trialLengthLabel,
  trialNounPhrase,
  trialOfferSentence,
  trialThenPriceLine,
} from "@/lib/stripe/trial-experiment";

/**
 * MW-V11-01: commercial copy contract.
 *
 * Three defects were live on the landing page when this file was written, and
 * every test here fails if one of them comes back:
 *
 *  1. The hero rendered "…the day you actually have.Tell Mellowa…" — no space.
 *     JSX drops the whitespace between an expression and an adjacent text node
 *     that spans lines, so `{TERMS.promise} Tell Mellowa…` lost its space the
 *     moment the paragraph wrapped. Invisible in the source.
 *  2. `trialOfferSentence(3)` produced "a 3 days trial" and `startTrialCta(3)`
 *     produced "Start 3 days free" — the noun form used where the sentence
 *     needs the adjective.
 *  3. The hero stated the no-card fact twice in one paragraph, in two
 *     different wordings.
 *
 * These are contract tests over the copy helpers and the source of the public
 * surfaces. They cannot prove the browser renders it correctly — that is what
 * the rendered-text assertions in `e2e/public.spec.ts` are for, and the reason
 * defect 1 survived a 900-test suite is that nothing asserted on a render.
 */

const PUBLIC_SURFACES = [
  "src/app/page.tsx",
  "src/app/pricing/page.tsx",
  "src/app/terms/page.tsx",
  "src/app/refund/page.tsx",
  "src/app/privacy/page.tsx",
];

const read = (path: string) => readFileSync(path, "utf8");

/** Every day count the allowlist can assign, plus edges worth checking. */
const LENGTHS = [null, 1, 3, 7, 8, 14] as const;

describe("grammar: noun form versus adjective form", () => {
  it("uses the adjective form wherever the sentence needs a modifier", () => {
    expect(trialOfferSentence(3)).toBe(
      "Premium starts with a 3-day trial when you choose a plan.",
    );
    expect(startTrialCta(3)).toBe("Start free 3-day trial");
    expect(trialNounPhrase(3)).toBe("a 3-day trial");
  });

  it("keeps the noun form where the number stands alone", () => {
    // "for 3 days", "3 days free" — no article, no following noun.
    expect(trialLengthLabel(3)).toBe("3 days");
    expect(trialThenPriceLine(3, "€9.99", "month")).toBe(
      "3 days free, then €9.99 each month",
    );
  });

  it("gets singular right", () => {
    expect(trialLengthLabel(1)).toBe("1 day");
    expect(trialNounPhrase(1)).toBe("a 1-day trial");
    expect(startTrialCta(1)).toBe("Start free 1-day trial");
    // The bug shape in reverse: never "1 days".
    for (const copy of [trialLengthLabel(1), trialNounPhrase(1), startTrialCta(1)]) {
      expect(copy).not.toMatch(/\b1 days\b/);
    }
  });

  it("chooses the article by how the number is spoken", () => {
    expect(trialNounPhrase(8)).toBe("an 8-day trial");
    expect(trialNounPhrase(3)).toBe("a 3-day trial");
  });

  it("never emits the ungrammatical shape at any length", () => {
    for (const days of LENGTHS) {
      const all = [
        trialLengthLabel(days),
        startTrialCta(days),
        trialOfferSentence(days),
        trialNounPhrase(days) ?? "",
        trialThenPriceLine(days, "€9.99", "month"),
      ];
      for (const copy of all) {
        // "a 3 days trial" / "a 3 days" — an article with the plural noun form.
        expect(copy, `ungrammatical: ${copy}`).not.toMatch(/\ba \d+ days\b/);
        // "3 days trial" — plural noun used attributively.
        expect(copy, `ungrammatical: ${copy}`).not.toMatch(/\d+ days trial/);
        // "Start 3 days free" — the old CTA.
        expect(copy, `old CTA shape: ${copy}`).not.toMatch(/Start \d+ days free/);
      }
    }
  });

  it("stays length-neutral and digit-free when no length is assigned", () => {
    expect(trialLengthAdjective(null)).toBeNull();
    expect(trialNounPhrase(null)).toBeNull();
    expect(trialOfferSentence(null)).not.toMatch(/\d/);
    expect(startTrialCta(null)).toBe("Start your free trial");
    expect(trialOfferSentence(null)).toMatch(/shown before checkout/i);
  });
});

describe("whitespace boundaries survive composition", () => {
  it("joins sentences with exactly one space", () => {
    expect(joinSentences("One.", "Two.")).toBe("One. Two.");
    expect(joinSentences("One.", "Two.")).not.toMatch(/\.\S/);
  });

  it("drops empty parts instead of leaving a double space", () => {
    // trialNounPhrase() and friends return null when the length is unknown.
    expect(joinSentences("One.", null, undefined, "  ", "Two.")).toBe("One. Two.");
    expect(joinSentences("One.", "")).toBe("One.");
  });

  it("normalizes ragged spacing from wrapped source strings", () => {
    expect(joinSentences("  One.  ", "  Two.  ")).toBe("One. Two.");
  });

  it("composes the hero sentence with its space intact", () => {
    const hero = joinSentences(TERMS.promise, "Tell Mellowa the energy.");
    expect(hero).toContain("have. Tell Mellowa");
    // The exact rendered defect: a sentence-ending period glued to a capital.
    expect(hero).not.toMatch(/[a-z]\.[A-Z]/);
  });

  it("composes the sample helper with its space intact", () => {
    const helper = joinSentences(TERMS.sampleHelper, trialOfferSentence(3));
    expect(helper).not.toMatch(/[a-z]\.[A-Z]/);
    expect(helper).toContain("a 3-day trial");
  });
});

describe("the hero states each commercial fact once", () => {
  /** Source with comments stripped: a comment may legitimately quote a defect. */
  const source = read("src/app/page.tsx")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

  it("does not concatenate an expression with adjacent JSX prose", () => {
    // The precise source shape that produced the missing space: an expression
    // closing a line, with prose continuing on the next line of the same text
    // run. Written this way the space between them does not survive JSX.
    expect(source).not.toMatch(/\{TERMS\.promise\}\s*\n\s*[A-Za-z]/);
    expect(source).not.toMatch(/\{trialOfferSentence\([^)]*\)\}\s*\n\s*[A-Za-z]/);
  });

  /**
   * The disclosure a visitor actually reads above the fold, composed the same
   * way the page composes it. Counting mentions in the JSX would count zero,
   * because the sentences live in the canonical helpers.
   */
  const aboveFoldCopy = joinSentences(TERMS.sampleHelper, trialOfferSentence(3));

  it("discloses the no-card fact exactly once above the fold", () => {
    const mentions = aboveFoldCopy.match(/no (?:payment )?card|without a card/gi) ?? [];
    expect(
      mentions.length,
      `no-card disclosed ${mentions.length}×: "${aboveFoldCopy}"`,
    ).toBe(1);
  });

  it("states the account requirement exactly once above the fold", () => {
    const mentions = aboveFoldCopy.match(/an account is required/gi) ?? [];
    expect(mentions.length).toBe(1);
  });

  it("still discloses both facts a visitor needs before signing up", () => {
    expect(aboveFoldCopy).toMatch(/account is required/i);
    expect(aboveFoldCopy).toMatch(/no payment card/i);
  });

  it("keeps the canonical promise as the first sentence of the hero", () => {
    expect(TERMS.promise).toMatch(/the day you actually have\.$/);
    // Composed, not adjacent — whichever helper the page uses, it must be one.
    expect(source).toMatch(/joinSentences\(\s*TERMS\.promise/);
  });
});

describe("no public surface hardcodes a trial length", () => {
  it.each(PUBLIC_SURFACES)("%s derives the length from the server", (path) => {
    // Comments stripped: prose about the rule may name an example length.
    const source = read(path)
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*\/\/.*$/gm, " ");
    // A literal "3-day"/"3 days" in a component is a length that cannot follow
    // a cohort assignment. MW-V10-02 deleted TRIAL_DAYS for this reason.
    expect(source, `${path} names a fixed trial length`).not.toMatch(
      /\b\d+[- ]days?\s+(?:free\s+)?trial\b/i,
    );
  });

  it("the landing page reads the length from publicTrialDays", () => {
    expect(read("src/app/page.tsx")).toContain("publicTrialDays");
    // And that helper returns null — not a guess — once a cohort is assigned.
    expect(
      publicTrialDays({
        FLAG_TRIAL_LENGTH_EXPERIMENT: "1",
        TRIAL_EXPERIMENT_VARIANT: "week_beta",
        TRIAL_EXPERIMENT_PERCENT: "50",
      }),
    ).toBeNull();
  });
});

describe("sample and trial are never merged into one free-trial claim", () => {
  const surfaces = PUBLIC_SURFACES.map((p) => ({ path: p, source: read(p) }));

  it.each(surfaces.map((s) => s.path))("%s keeps the two offers distinct", (path) => {
    const source = read(path);
    // "free trial" describing the sample, or a sample that "starts your trial".
    expect(source).not.toMatch(/free trial (?:day|sample)/i);
    expect(source).not.toMatch(/sample[^.]{0,40}starts? your (?:free )?trial/i);
  });

  it("never claims the trial needs no card", () => {
    // The card is required for the trial and not for the sample. Collapsing
    // that distinction is the single most expensive copy error available here.
    for (const { path, source } of surfaces) {
      expect(source, `${path} implies a cardless trial`).not.toMatch(
        /trial[^.]{0,40}no (?:payment )?card/i,
      );
      expect(source, `${path} implies a cardless trial`).not.toMatch(
        /no (?:payment )?card[^.]{0,30}trial/i,
      );
    }
  });

  it("uses no blanket 'no card required' or 'free forever' language", () => {
    for (const { path, source } of surfaces) {
      expect(source, path).not.toMatch(/free forever/i);
      expect(source, path).not.toMatch(/no card required/i);
    }
  });
});

describe("metadata and structured data carry the same commercial truth", () => {
  const source = read("src/app/page.tsx");

  it("the JSON-LD and FAQ never name a trial length the server did not assign", () => {
    const jsonLdStart = source.indexOf("const jsonLd");
    expect(jsonLdStart).toBeGreaterThan(-1);
    const jsonLd = source.slice(jsonLdStart, source.indexOf("export default"));
    expect(jsonLd).not.toMatch(/\b\d+[- ]days?\s+(?:free\s+)?trial\b/i);
  });

  it("the page description makes no trial claim at all", () => {
    const metaStart = source.indexOf("export const metadata");
    const meta = source.slice(metaStart, source.indexOf("\n};", metaStart));
    expect(meta).not.toMatch(/trial/i);
  });
});

describe("every surface that names a trial imports the canonical helpers", () => {
  it("no component builds trial wording from its own string template", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(`${dir}/${entry.name}`)
          : /\.tsx?$/.test(entry.name)
            ? [`${dir}/${entry.name}`]
            : [],
      );

    const offenders: string[] = [];
    for (const file of [...walk("src/app"), ...walk("src/components")]) {
      const source = read(file);
      // A template literal that inlines a day count next to the word "trial".
      if (/\$\{[^}]*\}\s*days?\s+trial/i.test(source)) offenders.push(file);
    }
    expect(offenders, `built trial wording locally: ${offenders.join(", ")}`).toEqual([]);
  });
});
