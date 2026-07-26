import { CARRY_EFFECTS } from "./reflection";

/**
 * MW-V10-02: an illustrative Week closeout for someone whose trial is shorter
 * than a week.
 *
 * The problem this solves: Premium promises "carry it into next week", but a
 * 3-day trial ends before a real week closeout exists. Rather than generating a
 * fake history — which would be a lie about the user's own days — this module
 * describes what the Week view will contain, using an example that is labelled
 * as an example everywhere it appears.
 *
 * Rules encoded here:
 * - No sentence is written in the second person past tense. Nothing says or
 *   implies "you created", "you completed" or "you saved", because the user
 *   recorded none of it.
 * - The example numbers are fixed constants, never derived from the user's
 *   rows, so a sparse week cannot be dressed up as a full one.
 * - The carry-forward effects are read from CARRY_EFFECTS, the same mapping the
 *   real feature applies. What is illustrated is exactly what would happen.
 */

export const WEEK_PREVIEW_LABEL = "Example";

export interface WeekPreviewCarry {
  choice: string;
  /** The real, canonical effect string — not preview-only wording. */
  effect: string;
}

export interface WeekPreviewContent {
  label: string;
  heading: string;
  intro: string;
  /** Example lines, each phrased as what the section shows — never as history. */
  exampleFacts: readonly string[];
  carry: readonly WeekPreviewCarry[];
  /** The explicit, unavoidable statement that none of this is the user's data. */
  disclaimer: string;
  /** What the user can do now, inside a short trial. */
  nextStep: string;
}

/**
 * `carryForwardEffects` covers a saved reflection; here we need the same
 * effects for two illustrative choices, read from the canonical mapping so this
 * file cannot drift into promising something the generator would not do.
 */
const EXAMPLE_CHOICES: readonly { key: string; choice: string }[] = [
  { key: "keep:meals", choice: "Keep meals that worked" },
  { key: "lighter:mornings", choice: "Make mornings lighter" },
  { key: "constraint:less_time", choice: "Less time next week" },
];

export function weekPreviewContent(): WeekPreviewContent {
  return {
    label: WEEK_PREVIEW_LABEL,
    heading: "What a week closeout looks like",
    intro:
      "Your trial is shorter than a week, so there is no week to summarise yet. This is what this page shows once a week of your own days is recorded.",
    exampleFacts: [
      "A count of the daily plans that were created that week.",
      "Which day modes were chosen — lightest, balanced or reset.",
      "The items marked helpful, and the days that felt like too much, in your own feedback words.",
      "The meals that were saved.",
    ],
    carry: EXAMPLE_CHOICES.filter((c) => CARRY_EFFECTS[c.key]).map((c) => ({
      choice: c.choice,
      effect: CARRY_EFFECTS[c.key],
    })),
    disclaimer:
      "These example lines are not your data. The numbers on this page only ever come from days you actually record.",
    nextStep:
      "Carry forward below already works today — the choices you make there shape your next plans, whether or not a full week is recorded.",
  };
}
