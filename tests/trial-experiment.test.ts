import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONTROL_TRIAL_DAYS,
  TRIAL_VARIANTS,
  assignmentBucket,
  chargeDateFor,
  experimentProperty,
  isTrialVariant,
  publicTrialDays,
  resolveTrialConfig,
  startTrialCta,
  trialDaysFromDates,
  trialExperimentSettings,
  trialLengthAdjective,
  trialLengthLabel,
  trialOfferSentence,
  trialThenPriceLine,
} from "@/lib/stripe/trial-experiment";
import { trialStartedEmail } from "@/lib/email/templates";
import { weekPreviewContent } from "@/lib/week/preview";
import { CARRY_EFFECTS } from "@/lib/week/reflection";
import { trialExperimentComparison, MIN_COHORT } from "@/lib/analytics/metrics";
import { propertiesSchema, EVENT_NAMES } from "@/lib/analytics/taxonomy";

/**
 * MW-V10-02: trial-length experiment.
 *
 * The failure modes this file exists to prevent are commercial, not cosmetic:
 * a user shown one trial length and given another, a live trial silently
 * re-timed by a flag change, a browser choosing its own charge date, or a
 * two-person cohort read as a 0% result.
 */

const USERS = Array.from({ length: 400 }, (_, i) => `user-${i}`);

const ON = {
  FLAG_TRIAL_LENGTH_EXPERIMENT: "1",
  TRIAL_EXPERIMENT_VARIANT: "week_beta",
  TRIAL_EXPERIMENT_PERCENT: "50",
} as const;

describe("variant allowlist", () => {
  it("is closed — unknown codes are never a trial length", () => {
    expect(isTrialVariant("control")).toBe(true);
    expect(isTrialVariant("week_beta")).toBe(true);
    for (const bad of ["", "30_day", "toString", "constructor", null, 7]) {
      expect(isTrialVariant(bad)).toBe(false);
    }
  });

  it("keeps control at the current production length", () => {
    expect(TRIAL_VARIANTS.control).toBe(3);
    expect(CONTROL_TRIAL_DAYS).toBe(3);
    // The variant only makes sense if it actually spans a week closeout.
    expect(TRIAL_VARIANTS.week_beta).toBe(7);
  });
});

describe("settings are opt-in and fail closed", () => {
  it("is inactive with no env at all", () => {
    expect(trialExperimentSettings({}).active).toBe(false);
    expect(publicTrialDays({})).toBe(CONTROL_TRIAL_DAYS);
  });

  it("is inactive when the flag is on but the rollout is 0%", () => {
    expect(
      trialExperimentSettings({ ...ON, TRIAL_EXPERIMENT_PERCENT: "0" }).active
    ).toBe(false);
  });

  it("is inactive when the variant code is not allowlisted", () => {
    const s = trialExperimentSettings({
      ...ON,
      TRIAL_EXPERIMENT_VARIANT: "month_long",
    });
    expect(s.active).toBe(false);
    expect(s.variant).toBe("control");
  });

  it("ignores a nonsense or out-of-range percentage rather than guessing", () => {
    for (const percent of ["abc", "-5", "101", "12.5", ""]) {
      expect(
        trialExperimentSettings({ ...ON, TRIAL_EXPERIMENT_PERCENT: percent })
          .percent
      ).toBe(0);
    }
  });

  it("becomes active only with flag + allowlisted variant + percent > 0", () => {
    expect(trialExperimentSettings(ON).active).toBe(true);
  });
});

describe("assignment", () => {
  it("is stable for the same user and salt", () => {
    for (const u of USERS.slice(0, 20)) {
      expect(assignmentBucket(u, "s")).toBe(assignmentBucket(u, "s"));
    }
  });

  it("is bounded to 0–99", () => {
    for (const u of USERS) {
      const b = assignmentBucket(u, "s");
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });

  it("re-buckets when the salt changes, so a new experiment is genuinely new", () => {
    const moved = USERS.filter(
      (u) => assignmentBucket(u, "a") !== assignmentBucket(u, "b")
    );
    expect(moved.length).toBeGreaterThan(USERS.length / 2);
  });

  it("splits roughly to the configured percentage", () => {
    const inVariant = USERS.filter(
      (u) => resolveTrialConfig({ userId: u, env: ON }).variant === "week_beta"
    ).length;
    const share = inVariant / USERS.length;
    expect(share).toBeGreaterThan(0.35);
    expect(share).toBeLessThan(0.65);
  });

  it("gives everyone control while the experiment is inactive", () => {
    for (const u of USERS.slice(0, 50)) {
      const r = resolveTrialConfig({ userId: u, env: {} });
      expect(r).toEqual({ variant: "control", days: 3, source: "control" });
    }
  });
});

describe("a pinned trial is never re-timed", () => {
  const pinned = { trial_variant: "week_beta", trial_days: 7 };

  it("keeps the pinned length when the flag is turned off", () => {
    const r = resolveTrialConfig({ userId: "u", pinned, env: {} });
    expect(r).toEqual({ variant: "week_beta", days: 7, source: "pinned" });
  });

  it("keeps the pinned length when the rollout percentage changes to 0", () => {
    const r = resolveTrialConfig({
      userId: "u",
      pinned,
      env: { ...ON, TRIAL_EXPERIMENT_PERCENT: "0" },
    });
    expect(r.days).toBe(7);
  });

  it("keeps the pinned DAY COUNT even if the variant code is retired", () => {
    // The number is the promise that was made; the code is only a label.
    const r = resolveTrialConfig({
      userId: "u",
      pinned: { trial_variant: "retired_arm", trial_days: 7 },
      env: {},
    });
    expect(r.days).toBe(7);
    expect(r.variant).toBe("control");
  });

  it("ignores an impossible stored length instead of disclosing it", () => {
    for (const trial_days of [0, -3, 400, 3.5]) {
      const r = resolveTrialConfig({
        userId: "u",
        pinned: { trial_variant: "control", trial_days },
        env: {},
      });
      expect(r.source).not.toBe("pinned");
      expect(r.days).toBe(CONTROL_TRIAL_DAYS);
    }
  });
});

describe("anonymous surfaces never guess an arm", () => {
  it("names the control length while no experiment runs (copy unchanged)", () => {
    expect(publicTrialDays({})).toBe(3);
    // MW-V11-01: attributive form. "a 3 days trial" was live copy.
    expect(trialOfferSentence(publicTrialDays({}))).toContain("a 3-day trial");
  });

  it("stops naming a length once a cohort is being assigned", () => {
    expect(publicTrialDays(ON)).toBeNull();
    const sentence = trialOfferSentence(null);
    expect(sentence).not.toMatch(/\d/);
    expect(sentence).toMatch(/shown before checkout/i);
  });
});

describe("disclosure copy", () => {
  it("states the exact assigned number, never the other arm's", () => {
    expect(trialLengthLabel(3)).toBe("3 days");
    expect(trialLengthLabel(7)).toBe("7 days");
    expect(trialLengthLabel(1)).toBe("1 day");
    expect(trialLengthAdjective(7)).toBe("7-day");
    expect(startTrialCta(3)).toBe("Start free 3-day trial");
    expect(startTrialCta(7)).toBe("Start free 7-day trial");
  });

  it("never says 'free week' or 'a week free' for any length", () => {
    // The prompt's rule: a week claim is only legitimate when checkout really
    // grants seven days. Naming the day count keeps both arms checkable, so we
    // never use the ambiguous phrasing at all.
    const all = [null, 1, 3, 7, 14].flatMap((d) => [
      trialLengthLabel(d as number | null),
      startTrialCta(d as number | null),
      trialOfferSentence(d as number | null),
      trialThenPriceLine(d as number | null, "€9.99", "month"),
    ]);
    for (const copy of all) {
      expect(copy.toLowerCase()).not.toMatch(/free week|week free/);
    }
  });

  it("promises the exact date at checkout when the length is unknown", () => {
    expect(startTrialCta(null)).toBe("Start your free trial");
    expect(trialThenPriceLine(null, "€9.99", "month")).toMatch(
      /shown before checkout/i
    );
  });

  it("computes the charge date from the assigned length", () => {
    const from = new Date("2026-07-26T10:00:00.000Z");
    expect(chargeDateFor(3, from)).toBe("2026-07-29");
    expect(chargeDateFor(7, from)).toBe("2026-08-02");
    expect(chargeDateFor(0, from)).toBe("2026-07-26");
  });

  it("derives the granted length from the real Stripe window", () => {
    expect(
      trialDaysFromDates("2026-07-26T10:00:00Z", "2026-08-02T10:00:00Z")
    ).toBe(7);
    expect(
      trialDaysFromDates("2026-07-26T10:00:00Z", "2026-07-29T10:00:00Z")
    ).toBe(3);
    // Missing, reversed or absurd windows yield null, not a fabricated number.
    expect(trialDaysFromDates(null, "2026-08-02T10:00:00Z")).toBeNull();
    expect(
      trialDaysFromDates("2026-08-02T10:00:00Z", "2026-07-26T10:00:00Z")
    ).toBeNull();
    expect(trialDaysFromDates("2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z")).toBeNull();
  });
});

describe("lifecycle email reflects the assigned variant", () => {
  it("uses the granted length in subject and preheader", () => {
    expect(trialStartedEmail({}, 7).subject).toContain("7-day");
    expect(trialStartedEmail({}, 7).html).toContain("Full access for 7 days");
    expect(trialStartedEmail({}, 3).subject).toContain("3-day");
  });

  it("never states a length it was not given", () => {
    const e = trialStartedEmail();
    expect(e.subject).not.toMatch(/\d/);
    expect(e.html).not.toMatch(/Full access for \d/);
  });

  it("still states the exact price and charge date when facts are known", () => {
    const e = trialStartedEmail(
      { plan: "Monthly plan", price: "€9.99", date: "2 August 2026" },
      7
    );
    expect(e.html).toContain("€9.99");
    expect(e.html).toContain("2 August 2026");
  });
});

describe("checkout route: server owns the length and the date", () => {
  const route = readFileSync("src/app/api/stripe/checkout/route.ts", "utf8");

  it("asks Stripe for the resolved length, not a constant", () => {
    expect(route).toContain("resolveTrialConfig");
    expect(route).toContain("trial_period_days: trialConfig.days");
    expect(route).not.toContain("trial_period_days: TRIAL_DAYS");
  });

  it("pins the assignment before creating the session", () => {
    const pinAt = route.indexOf("trial_variant_assigned_at");
    const sessionAt = route.indexOf("checkout.sessions.create");
    expect(pinAt).toBeGreaterThan(-1);
    expect(pinAt).toBeLessThan(sessionAt);
  });

  it("fails the request rather than opening an unpinned checkout", () => {
    expect(route).toMatch(/could not pin trial variant/);
    // A zero-row update is not a Postgres error but is still a failed pin.
    expect(route).toMatch(/!pinned\?\.length/);
  });

  it("keys idempotency on the trial length, so a re-pin can't serve a stale session", () => {
    expect(route).toMatch(/trial\$\{trialConfig\.days\}/);
  });

  it("returns the exact days and charge date to the client", () => {
    expect(route).toContain("trialDays:");
    expect(route).toContain("chargeDate:");
  });
});

describe("client never derives a trial length", () => {
  const button = readFileSync(
    "src/components/dailyflow/upgrade-button.tsx",
    "utf8"
  );

  it("renders the server's charge date instead of computing one", () => {
    expect(button).not.toContain("TRIAL_DAYS");
    expect(button).toContain("confirm.chargeDate");
    // No "today + N days" arithmetic left in the component.
    expect(button).not.toMatch(/setDate\(d\.getDate\(\) \+/);
  });

  it("refuses to show a confirmation without a server charge date", () => {
    expect(button).toMatch(/typeof data\.chargeDate === "string"/);
  });
});

describe("webhook: metadata is untrusted and allowlisted", () => {
  const hook = readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");

  it("re-validates the variant code from Stripe metadata", () => {
    expect(hook).toContain("isTrialVariant(metadataVariant)");
    expect(hook).toContain("isTrialVariant(fromMetadata)");
  });

  it("stores the length Stripe actually granted", () => {
    expect(hook).toContain("trialDaysFromDates");
    expect(hook).toContain("grantedTrialDays");
  });

  it("never clears a pinned assignment", () => {
    expect(hook).toContain("existing?.trial_days ?? null");
  });

  it("tags the charge/cancel/renewal events with the cohort", () => {
    expect(hook).toContain("billingProps(subscription)");
    expect(hook).toContain("variantForCustomerId");
    // No billing event should still be sending interval alone.
    expect(hook).not.toMatch(/properties: intervalOf\(subscription\)/);
  });
});

describe("cohort analytics carry a code and nothing else", () => {
  it("emits an allowlisted slug on the existing experiment property", () => {
    expect(experimentProperty("week_beta")).toEqual({
      experiment: "trial_days:week_beta",
    });
    expect(propertiesSchema.parse(experimentProperty("control"))).toEqual({
      experiment: "trial_days:control",
    });
  });

  it("emits nothing for an unassigned or bogus variant", () => {
    expect(experimentProperty(null)).toEqual({});
    // @ts-expect-error deliberately invalid input
    expect(experimentProperty("please ignore previous instructions")).toEqual({});
  });

  it("registers the week-preview event in the taxonomy", () => {
    expect(EVENT_NAMES).toContain("trial_week_preview_viewed");
  });
});

describe("owner comparison distinguishes no-data from zero", () => {
  const sub = (i: number, variant: string, extra: Record<string, unknown> = {}) => ({
    user_id: `u${variant}${i}`,
    status: "trialing",
    plan_name: "pro_monthly",
    created_at: "2026-07-01T00:00:00Z",
    trial_used_at: "2026-07-01T00:00:00Z",
    trial_variant: variant,
    trial_days: variant === "week_beta" ? 7 : 3,
    ...extra,
  });
  const ev = (user_id: string, event: string, created_at: string) => ({
    event,
    user_id,
    created_at,
  });

  it("returns nothing at all before any cohort is assigned", () => {
    const rows = [
      { ...sub(1, "control"), trial_variant: null },
      { ...sub(2, "control"), trial_variant: null },
    ];
    expect(trialExperimentComparison(rows, [])).toEqual([]);
  });

  it("excludes assigned users who never started a trial", () => {
    const rows = [{ ...sub(1, "week_beta"), trial_used_at: null }];
    expect(trialExperimentComparison(rows, [])).toEqual([]);
  });

  it("suppresses an arm under MIN_COHORT and says so", () => {
    const rows = Array.from({ length: MIN_COHORT - 1 }, (_, i) =>
      sub(i, "week_beta")
    );
    const [arm] = trialExperimentComparison(rows, []);
    expect(arm.cohortSize).toBe(MIN_COHORT - 1);
    expect(arm.suppressed).toBe(true);
    // Critically: not 0 — an owner must not read a tiny arm as a failed one.
    expect(arm.converted).toBeNull();
    expect(arm.conversionRate).toBeNull();
    expect(arm.costUsd).toBeNull();
  });

  it("reports real figures once an arm clears MIN_COHORT", () => {
    const rows = Array.from({ length: MIN_COHORT }, (_, i) => sub(i, "week_beta"));
    const events = [
      // Two people came back a day later, one adjusted, one closed a week out.
      ev("uweek_beta0", "checkin_completed", "2026-07-03T00:00:00Z"),
      ev("uweek_beta1", "checkin_completed", "2026-07-04T00:00:00Z"),
      // Same-day check-in must NOT count as a return.
      ev("uweek_beta2", "checkin_completed", "2026-07-01T01:00:00Z"),
      ev("uweek_beta0", "plan_repair_completed", "2026-07-03T00:00:00Z"),
      ev("uweek_beta0", "weekly_reflection_completed", "2026-07-08T00:00:00Z"),
      ev("uweek_beta0", "trial_converted", "2026-07-08T00:00:00Z"),
      ev("uweek_beta1", "trial_canceled", "2026-07-05T00:00:00Z"),
    ];
    const costs = [
      { user_id: "uweek_beta0", status: "succeeded", estimated_cost_usd: 0.5 },
      { user_id: "uweek_beta1", status: "released", estimated_cost_usd: 9 },
    ];
    const [arm] = trialExperimentComparison(rows, events, costs);
    expect(arm.variant).toBe("week_beta");
    expect(arm.trialDays).toBe(7);
    expect(arm.suppressed).toBe(false);
    expect(arm.returnedAfterDay1).toBe(2);
    expect(arm.repaired).toBe(1);
    expect(arm.weeklyReflection).toBe(1);
    expect(arm.converted).toBe(1);
    expect(arm.canceled).toBe(1);
    expect(arm.conversionRate).toBe(0.2);
    // A released reservation made no provider call, so it costs nothing.
    expect(arm.costUsd).toBe(0.5);
  });

  it("keeps the arms separate and sorted", () => {
    const rows = [
      ...Array.from({ length: MIN_COHORT }, (_, i) => sub(i, "week_beta")),
      ...Array.from({ length: MIN_COHORT }, (_, i) => sub(i, "control")),
    ];
    const arms = trialExperimentComparison(rows, []);
    expect(arms.map((a) => a.variant)).toEqual(["control", "week_beta"]);
    expect(arms.map((a) => a.trialDays)).toEqual([3, 7]);
  });
});

describe("week preview illustrates without fabricating", () => {
  const content = weekPreviewContent();
  const card = readFileSync(
    "src/components/dailyflow/week-preview-card.tsx",
    "utf8"
  );
  const page = readFileSync("src/app/(app)/weekly-plan/page.tsx", "utf8");

  it("is labelled as an example and says the data is not the user's", () => {
    expect(content.label.toLowerCase()).toContain("example");
    expect(content.disclaimer).toMatch(/not your data/i);
    expect(card).toMatch(/aria-label="Example of a week closeout — not your data"/);
  });

  it("never claims the user recorded days they did not", () => {
    const prose = [
      content.intro,
      content.disclaimer,
      content.nextStep,
      ...content.exampleFacts,
    ].join(" ");
    expect(prose).not.toMatch(/you (created|completed|saved|marked|chose)/i);
    expect(prose).not.toMatch(/your (streak|score)/i);
  });

  it("contains no example numbers that could read as the user's history", () => {
    for (const fact of content.exampleFacts) {
      expect(fact).not.toMatch(/\d/);
    }
  });

  it("illustrates carry-forward with the real canonical effects", () => {
    expect(content.carry.length).toBeGreaterThan(1);
    const effects = Object.values(CARRY_EFFECTS);
    for (const c of content.carry) {
      expect(effects).toContain(c.effect);
    }
  });

  it("shows only for a trial shorter than a week with no recorded week", () => {
    expect(page).toMatch(/sub\.trialLengthDays < 7/);
    expect(page).toMatch(/!hasRecordedWeek && shortTrialDays !== null/);
  });
});

/**
 * The durable guard: no surface may hardcode a trial length again. A literal
 * "3 days" in a page is exactly how a 7-day cohort ends up reading 3-day copy,
 * and it cannot be caught by rendering the default configuration.
 */
describe("no surface hardcodes a trial length", () => {
  const SURFACES = [
    "src/app/page.tsx",
    "src/app/pricing/page.tsx",
    "src/app/terms/page.tsx",
    "src/app/refund/page.tsx",
    "src/app/(app)/billing/page.tsx",
    "src/components/dailyflow/upgrade-button.tsx",
    "src/components/dailyflow/trial-banner.tsx",
    "src/components/dailyflow/low-energy-day-card.tsx",
    "src/lib/content/terminology.ts",
    "src/lib/email/templates.ts",
  ];

  it.each(SURFACES)("%s names no fixed number of trial days", (file) => {
    const src = readFileSync(file, "utf8");
    // Matches "3 days", "3-day", "seven days" etc. in any string literal.
    expect(src).not.toMatch(/\d+[ -]days? (free|trial)/i);
    expect(src).not.toMatch(/\d+-day (free )?trial/i);
    expect(src).not.toMatch(/(three|seven)[ -]days?/i);
  });

  it.each(SURFACES)("%s derives the length from the server resolution", (file) => {
    const src = readFileSync(file, "utf8");
    const namesTrial = /trial/i.test(src);
    if (!namesTrial) return;
    // Either it takes the length from the shared helpers, or it says nothing
    // about a length at all (the paywall message, for instance).
    const derives =
      /trialLengthLabel|trialLengthAdjective|startTrialCta|trialThenPriceLine|trialOfferSentence|publicTrialDays|trialDisclosureForViewer|trialDays/.test(
        src
      );
    const claimsLength = /days/i.test(src);
    expect(derives || !claimsLength, `${file} mentions days without deriving`).toBe(
      true
    );
  });

  it("keeps the legacy TRIAL_DAYS constant out of disclosure paths", () => {
    // plans.ts may still export it for the PRICING shape, but nothing that
    // renders a date or a CTA may read it.
    for (const file of SURFACES) {
      expect(readFileSync(file, "utf8"), file).not.toContain("TRIAL_DAYS");
    }
  });
});

describe("commercial terms are untouched by the experiment", () => {
  const plans = readFileSync("src/lib/stripe/plans.ts", "utf8");
  const refund = readFileSync("src/app/refund/page.tsx", "utf8");
  const doc = readFileSync("docs/experiments/trial-length.md", "utf8");

  it("keeps the canonical prices (USD primary, EUR region)", () => {
    expect(plans).toContain('display: "$12.99"');
    expect(plans).toContain('display: "$129.99"');
    expect(plans).toContain('display: "€11.99"');
  });

  it("keeps the refund policy wording", () => {
    expect(refund).toMatch(/You will not be charged during the\s+trial/);
    expect(refund).toMatch(/If you cancel before the trial ends, you pay\s+nothing/);
  });

  it("documents stop rules, including an unexpected charge as an immediate stop", () => {
    expect(doc).toMatch(/## Stop rules/);
    expect(doc).toMatch(/unexpected-charge/i);
    expect(doc).toMatch(/no retention lift/i);
    expect(doc).toMatch(/FLAG_TRIAL_LENGTH_EXPERIMENT=0/);
  });

  it("forbids running a second overlapping onboarding experiment", () => {
    expect(doc).toMatch(/FLAG_EMPHASIZE_YEARLY/);
    expect(doc).toMatch(/one onboarding experiment may run at a time/i);
  });
});
