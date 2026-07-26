import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loopDecisions, expansionVerdict } from "@/lib/analytics/loop-decisions";
import { costPerOutcome, MIN_COHORT, type FunnelStep } from "@/lib/analytics/metrics";
import {
  experimentConflicts,
  runningExperiments,
} from "@/lib/beta/experiments";
import {
  BETA_CLOSED_MESSAGE,
  isBetaGateError,
  BETA_CLOSED_CODE,
  BETA_FULL_CODE,
} from "@/lib/beta/capacity-shared";
import { FUNNELS } from "@/lib/analytics/taxonomy";

/**
 * MW-V10-06: evidence-backed beta decisions.
 *
 * The failure this guards against is a beta that talks itself into expanding:
 * reading a two-person cohort as a result, showing an unknown cost as zero,
 * running two experiments at once and attributing the outcome to one of them,
 * or "capping" intake with a number that lives only in a document.
 */

/** Build funnel steps with explicit reach counts, in canonical order. */
function steps(reached: Partial<Record<string, number>>): FunnelStep[] {
  let prev: number | null = null;
  return FUNNELS.value_loop.map((event) => {
    const n = reached[event] ?? 0;
    const stepRate =
      prev === null || prev < MIN_COHORT ? null : Math.round((n / prev) * 1000) / 1000;
    prev = n;
    return { event, reached: n, stepRate };
  });
}

describe("no data and below hypothesis are different states", () => {
  it("reports no_data when the prior cohort is too small to read", () => {
    const d = loopDecisions(steps({ signup_completed: 3, onboarding_completed: 1 }));
    const onboarding = d.find((x) => x.event === "onboarding_completed")!;
    expect(onboarding.state).toBe("no_data");
    expect(onboarding.rate).toBeNull();
    expect(onboarding.decision).toMatch(/not enough people/i);
    expect(onboarding.decision).toMatch(/do not report it as a result/i);
  });

  it("reports below_hypothesis when there IS data and it is weak", () => {
    const d = loopDecisions(
      steps({ signup_completed: 20, onboarding_completed: 4 })
    );
    const onboarding = d.find((x) => x.event === "onboarding_completed")!;
    expect(onboarding.state).toBe("below_hypothesis");
    expect(onboarding.rate).toBe(0.2);
    expect(onboarding.hypothesis).toBe(0.7);
  });

  it("reports meets_hypothesis when the step is working", () => {
    const d = loopDecisions(
      steps({ signup_completed: 20, onboarding_completed: 18 })
    );
    expect(d.find((x) => x.event === "onboarding_completed")!.state).toBe(
      "meets_hypothesis"
    );
  });

  it("always exposes numerator and denominator, so a rate can be checked", () => {
    const d = loopDecisions(steps({ signup_completed: 20, onboarding_completed: 15 }));
    const onboarding = d.find((x) => x.event === "onboarding_completed")!;
    expect(onboarding.numerator).toBe(15);
    expect(onboarding.denominator).toBe(20);
    // The first step has no prior step to divide by.
    expect(d[0].denominator).toBeNull();
  });

  it("gives every step a decision, and never 'add a notification'", () => {
    const d = loopDecisions(
      steps(Object.fromEntries(FUNNELS.value_loop.map((e) => [e, 6])))
    );
    for (const step of d) {
      expect(step.decision.length, String(step.event)).toBeGreaterThan(10);
    }
    const weak = loopDecisions(
      steps({ sample_plan_generated: 20, sample_plan_opened: 20, sample_value_action_completed: 20, trial_started: 20, checkin_completed: 2 })
    );
    const ret = weak.find((x) => x.event === "checkin_completed")!;
    expect(ret.decision).toMatch(/do NOT add notifications/i);
  });

  it("describes behaviour as use and return, never adherence or improvement", () => {
    // Assert on what an owner actually READS — the rendered strings — rather
    // than the source, whose comments legitimately name the banned words in
    // order to forbid them.
    const rendered = loopDecisions(
      steps(Object.fromEntries(FUNNELS.value_loop.map((e) => [e, 6])))
    )
      .flatMap((d) => [d.readsAs, d.decision])
      .join(" ")
      .toLowerCase();
    for (const banned of [
      "adherence",
      "compliance",
      "recovery",
      "healthier",
      "improved",
      "on track",
      "streak",
    ]) {
      expect(rendered, `loop output uses "${banned}"`).not.toContain(banned);
    }
  });
});

describe("the expansion question has one answer", () => {
  const fourWeeks = 28;

  it("blocks expansion when return is unreadable", () => {
    const v = expansionVerdict(loopDecisions(steps({ signup_completed: 3 })), fourWeeks);
    expect(v.canExpand).toBe(false);
    expect(v.reason).toMatch(/unreadable/i);
  });

  it("blocks expansion when return is below hypothesis", () => {
    const d = loopDecisions(steps({ trial_started: 20, checkin_completed: 2 }));
    const v = expansionVerdict(d, fourWeeks);
    expect(v.canExpand).toBe(false);
    expect(v.reason).toMatch(/fix the daily loop before widening/i);
  });

  it("blocks expansion before four weeks of evidence, even when return is good", () => {
    const d = loopDecisions(steps({ trial_started: 20, checkin_completed: 18 }));
    expect(expansionVerdict(d, 7).canExpand).toBe(false);
    expect(expansionVerdict(d, 7).reason).toMatch(/four weeks/i);
  });

  it("allows expansion only with four weeks AND a met return hypothesis", () => {
    const d = loopDecisions(steps({ trial_started: 20, checkin_completed: 18 }));
    const v = expansionVerdict(d, fourWeeks);
    expect(v.canExpand).toBe(true);
    expect(v.reason).toMatch(/cost per retained payer/i);
  });
});

describe("unknown cost stays unknown", () => {
  const usage = [
    { user_id: "a", status: "succeeded", estimated_cost_usd: 0.02, actual_cost_usd: 0.03 },
    { user_id: "b", status: "succeeded", estimated_cost_usd: 0.02, actual_cost_usd: null },
    { user_id: "c", status: "released", estimated_cost_usd: 9, actual_cost_usd: null },
  ];

  it("returns null, not zero, when there is no denominator", () => {
    const c = costPerOutcome(usage, {
      samplesGenerated: 0,
      trialsStarted: 0,
      retainedPayers: 0,
    });
    expect(c.perSampleUsd).toBeNull();
    expect(c.perActivatedTrialUsd).toBeNull();
    expect(c.perRetainedPayerUsd).toBeNull();
    // The spend itself is known and is not null.
    expect(c.totalCostUsd).toBe(0.05);
  });

  it("excludes released reservations — no provider call, no cost", () => {
    expect(costPerOutcome(usage, { samplesGenerated: 1, trialsStarted: 1, retainedPayers: 1 }).perSampleUsd).toBe(0.05);
  });

  it("divides by the real denominators when they exist", () => {
    const c = costPerOutcome(usage, {
      samplesGenerated: 5,
      trialsStarted: 2,
      retainedPayers: 1,
    });
    expect(c.perSampleUsd).toBe(0.01);
    expect(c.perActivatedTrialUsd).toBe(0.03);
    expect(c.perRetainedPayerUsd).toBe(0.05);
  });

  it("names what it could not observe rather than implying full coverage", () => {
    const c = costPerOutcome(usage, { samplesGenerated: 5, trialsStarted: 2, retainedPayers: 1 });
    expect(c.unknowns.join(" ")).toMatch(/stripe fees and infrastructure/i);
  });

  it("renders unknown as 'unknown' in the dashboard, never as $0.00", () => {
    const admin = readFileSync("src/app/admin/page.tsx", "utf8");
    expect(admin).toMatch(/v === null \? "unknown"/);
  });
});

describe("only one onboarding experiment at a time", () => {
  const trialOn = {
    FLAG_TRIAL_LENGTH_EXPERIMENT: "1",
    TRIAL_EXPERIMENT_PERCENT: "50",
  };

  it("sees nothing running by default", () => {
    expect(runningExperiments({})).toEqual([]);
    expect(experimentConflicts(runningExperiments({}))).toEqual([]);
  });

  it("does not count an experiment assigning 0% as running", () => {
    expect(
      runningExperiments({ ...trialOn, TRIAL_EXPERIMENT_PERCENT: "0" })
    ).toEqual([]);
  });

  it("accepts one onboarding experiment without complaint", () => {
    const running = runningExperiments(trialOn);
    expect(running.map((e) => e.id)).toEqual(["trial_length"]);
    expect(experimentConflicts(running)).toEqual([]);
  });

  it("flags two onboarding experiments as unattributable", () => {
    const running = runningExperiments({ ...trialOn, FLAG_EMPHASIZE_YEARLY: "1" });
    const conflicts = experimentConflicts(running);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].ids).toEqual(["trial_length", "yearly_emphasis"]);
    expect(conflicts[0].message).toMatch(/neither result will be attributable/i);
    // …and tells the owner exactly how to turn one off.
    expect(conflicts[0].message).toMatch(/FLAG_TRIAL_LENGTH_EXPERIMENT=0/);
  });

  it("is advisory, not fail-closed — it must not re-time a live trial", () => {
    const src = readFileSync("src/lib/beta/experiments.ts", "utf8");
    expect(src).toMatch(/advisory, not fail-closed/i);
    expect(src).not.toMatch(/throw new Error|process\.exit/);
  });

  it("is surfaced to the owner on the dashboard", () => {
    const admin = readFileSync("src/app/admin/page.tsx", "utf8");
    expect(admin).toContain("experimentConflicts");
  });
});

describe("the beta cap is real, not a number in a document", () => {
  const migration = readFileSync(
    "supabase/migrations/039_mellowa_v10_beta_capacity.sql",
    "utf8"
  );

  it("is enforced by a database trigger, not the signup form", () => {
    expect(migration).toMatch(/before insert on auth\.users/);
    expect(migration).toContain("enforce_beta_capacity");
    // The form calls supabase.auth.signUp directly, so a UI check is not a cap.
    expect(migration).toMatch(/trigger|form is a courtesy|only place the limit is real/i);
  });

  it("has a stop switch independent of the cap", () => {
    expect(migration).toContain("signups_open");
    expect(migration).toMatch(/if not v_open then/);
    expect(migration).toContain(BETA_CLOSED_CODE);
    expect(migration).toContain(BETA_FULL_CODE);
  });

  it("deletes nothing when intake closes", () => {
    // Only inserts are blocked; no delete/truncate anywhere in the migration.
    expect(migration.toLowerCase()).not.toMatch(/\bdelete from\b|\btruncate\b/);
  });

  it("fails OPEN when unconfigured, so a missing row cannot lock everyone out", () => {
    expect(migration).toMatch(/if v_open is null then\s+return new;/);
  });

  it("tells a rejected visitor the truth without leaking capacity", () => {
    expect(BETA_CLOSED_MESSAGE).toMatch(/closed beta/i);
    expect(BETA_CLOSED_MESSAGE).toMatch(/nothing was created/i);
    // No numbers: how full the beta is, is not the visitor's business, and a
    // countdown would manufacture urgency.
    expect(BETA_CLOSED_MESSAGE).not.toMatch(/\d/);
  });

  it("maps the trigger error to that copy instead of a raw database string", () => {
    expect(isBetaGateError("Database error: beta_capacity_reached")).toBe(true);
    expect(isBetaGateError("Database error: beta_signups_closed")).toBe(true);
    expect(isBetaGateError("invalid login credentials")).toBe(false);
    expect(isBetaGateError(null)).toBe(false);

    const form = readFileSync("src/components/forms/auth-form.tsx", "utf8");
    expect(form).toContain("isBetaGateError");
    expect(form).toContain("BETA_CLOSED_MESSAGE");
  });

  it("says so on the signup page before anyone types anything", () => {
    const page = readFileSync("src/app/(auth)/signup/page.tsx", "utf8");
    expect(page).toContain("readBetaCapacity");
    expect(page).toContain("BETA_CLOSED_MESSAGE");
    // An unreadable setting must not lock people out.
    expect(page).toMatch(/full = false;/);
  });
});

describe("no sensitive dimension can reach the beta analytics", () => {
  it("the loop reports only event names and counts", () => {
    const d = loopDecisions(steps({ signup_completed: 10, onboarding_completed: 8 }));
    const serialized = JSON.stringify(d).toLowerCase();
    for (const banned of ["mood", "energy", "allerg", "journal", "meal", "note"]) {
      expect(serialized, `loop output contains "${banned}"`).not.toContain(banned);
    }
  });

  it("cost per outcome carries no user identity", () => {
    const c = costPerOutcome(
      [{ user_id: "user-123", status: "succeeded", estimated_cost_usd: 1, actual_cost_usd: 1 }],
      { samplesGenerated: 1, trialsStarted: 1, retainedPayers: 1 }
    );
    expect(JSON.stringify(c)).not.toContain("user-123");
  });
});

describe("the weekly memo exists and forces a decision", () => {
  const doc = readFileSync("docs/beta-research.md", "utf8");

  it("offers exactly the five outcomes, so 'keep going' is a choice not a default", () => {
    for (const outcome of ["Continue", "Iterate", "Pause", "Roll back", "Stop"]) {
      expect(doc, `memo missing outcome: ${outcome}`).toContain(outcome);
    }
  });

  it("states the four-week expansion block", () => {
    expect(doc).toMatch(/four weeks/i);
    expect(doc).toMatch(/blocks expansion/i);
  });

  it("keeps cancellation neutral and never blocked by research", () => {
    expect(doc).toMatch(/never blocked|not blocked/i);
    expect(doc).toMatch(/optional/i);
  });
});
