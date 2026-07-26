import { FUNNELS, type AppEvent } from "@/lib/analytics/taxonomy";
import { MIN_COHORT, type FunnelStep } from "@/lib/analytics/metrics";

/**
 * MW-V10-06: the value loop, with a decision attached to every step.
 *
 * The dashboard already showed the funnel. What it did not show was what to DO
 * about any number on it — so a weak step produced a shrug, and the honest
 * answer ("stop adding features until this step works") was never in front of
 * the owner at the moment they were looking at the evidence.
 *
 * Two states are kept strictly apart, because conflating them is how a beta
 * talks itself into expanding:
 *   - **no data** — the cohort is under MIN_COHORT, so there is nothing to read;
 *   - **below hypothesis** — there IS data and it is worse than we hoped.
 *
 * Language is use / return / completion. Never adherence, improvement or
 * recovery: this measures whether people use the product, not whether they got
 * better, and the second claim is one we must never make.
 *
 * Pure module.
 */

export type StepState = "no_data" | "below_hypothesis" | "meets_hypothesis";

export interface LoopStepDecision {
  event: AppEvent;
  /** Plain reading of what reaching this step means. */
  readsAs: string;
  /** Distinct people who reached this step. */
  numerator: number;
  /** Distinct people who reached the PRIOR step. Null for the first step. */
  denominator: number | null;
  /** numerator ÷ denominator, or null when suppressed / first step. */
  rate: number | null;
  /** The share we would need to see to keep going. Null = no threshold set. */
  hypothesis: number | null;
  state: StepState;
  /** What the owner should do, given `state`. Always actionable. */
  decision: string;
}

/**
 * Hypotheses for a ≤50-person beta. These are deliberately modest and are NOT
 * statistical thresholds — at this cohort size nothing here is significant.
 * They are the line below which the honest reading is "this step is not
 * working", which is a product judgement, not a p-value.
 */
const HYPOTHESIS: Partial<Record<AppEvent, number>> = {
  onboarding_completed: 0.7,
  sample_plan_generated: 0.8,
  sample_plan_opened: 0.8,
  sample_value_action_completed: 0.3,
  trial_started: 0.25,
  checkin_completed: 0.4,
  now_action_done: 0.5,
  plan_repair_completed: 0.25,
  weekly_reflection_completed: 0.25,
  next_week_plan_created: 0.5,
  subscription_renewed: 0.5,
};

const READS_AS: Partial<Record<AppEvent, string>> = {
  signup_completed: "account created",
  onboarding_completed: "planning baseline set",
  sample_plan_generated: "first plan produced",
  sample_plan_opened: "first plan seen",
  sample_value_action_completed: "the sample demonstrated adaptation",
  trial_started: "intent to pay",
  checkin_completed: "came back on a later day",
  now_action_done: "completed one next step",
  plan_repair_completed: "used the adapt-the-day wedge",
  weekly_reflection_completed: "closed a week",
  next_week_plan_created: "carried decisions into the next week",
  subscription_renewed: "paid again",
};

/**
 * What to do when a step is below hypothesis. Every one of these is a
 * *product* decision — none of them is "add a notification", because nudging
 * harder is how a product hides weak retention instead of fixing it.
 */
const WEAK_DECISION: Partial<Record<AppEvent, string>> = {
  onboarding_completed:
    "Shorten the first run. Do not add steps; remove them.",
  sample_plan_generated:
    "Generation or the safety gate is failing. Investigate before widening intake — this is a stop-expansion signal, not a copy problem.",
  sample_plan_opened:
    "Delivery problem, not a product problem. Fix how the sample is surfaced; do not add features.",
  sample_value_action_completed:
    "The sample is not demonstrating the wedge. Interview 'sample, no return'. Consider changing what the sample DOES, not how it is described.",
  trial_started:
    "Price or paywall clarity. Interview on price and trust before touching the price itself.",
  checkin_completed:
    "The daily habit is not forming. Interview. Explicitly do NOT add notifications — that masks the problem.",
  now_action_done:
    "Now is not useful or not visible. Run the Now-default experiment (one at a time).",
  plan_repair_completed:
    "The adapt-the-day value is not landing or not trusted. Interview 'repair distrust'; consider the repair-preview experiment.",
  weekly_reflection_completed:
    "The weekly closeout is too heavy. Lighten it before adding to it.",
  next_week_plan_created:
    "Carry-forward is not compelling. Interview 'weekly no-return'.",
  subscription_renewed:
    "Retention economics do not hold. Check cost per retained payer before any acquisition spend.",
};

const NO_DATA_DECISION =
  "Not enough people have reached this step to read anything. Do not act on it, and do not report it as a result.";

const OK_DECISION = "Meets the beta hypothesis. Leave it alone and watch the next step.";

/**
 * Attach numerator, denominator, hypothesis, state and decision to each step of
 * the canonical value loop. Takes the already-computed funnel so the dashboard
 * and this table can never disagree about the counts.
 */
export function loopDecisions(steps: readonly FunnelStep[]): LoopStepDecision[] {
  const order = FUNNELS.value_loop;
  return steps.map((step, i) => {
    const denominator = i === 0 ? null : steps[i - 1].reached;
    const hypothesis = HYPOTHESIS[step.event] ?? null;

    // A rate computed from fewer than MIN_COHORT people is not a rate.
    const readable = denominator !== null && denominator >= MIN_COHORT;
    const rate = readable ? step.stepRate : null;

    let state: StepState;
    if (!readable || rate === null) {
      state = "no_data";
    } else if (hypothesis !== null && rate < hypothesis) {
      state = "below_hypothesis";
    } else {
      state = "meets_hypothesis";
    }

    const decision =
      state === "no_data"
        ? NO_DATA_DECISION
        : state === "below_hypothesis"
          ? WEAK_DECISION[step.event] ?? "Below the beta hypothesis — investigate before expanding."
          : OK_DECISION;

    return {
      event: step.event,
      readsAs: READS_AS[step.event] ?? String(step.event),
      numerator: step.reached,
      denominator,
      rate,
      hypothesis,
      state,
      decision,
    };
  }).slice(0, order.length);
}

/**
 * The single expansion question, answered from the loop.
 *
 * The rule from the beta plan: no meaningful return after four weeks blocks
 * expansion. "Meaningful return" is a later-day check-in — someone opening the
 * app again on a different day. Everything else is a nice-to-have.
 */
export interface ExpansionVerdict {
  canExpand: boolean;
  reason: string;
}

export function expansionVerdict(
  decisions: readonly LoopStepDecision[],
  windowDays: number
): ExpansionVerdict {
  const ret = decisions.find((d) => d.event === "checkin_completed");

  if (!ret || ret.state === "no_data") {
    return {
      canExpand: false,
      reason:
        "Return rate is unreadable at this cohort size. Expanding now would mean spending on acquisition without knowing whether anyone comes back.",
    };
  }

  if (ret.state === "below_hypothesis") {
    return {
      canExpand: false,
      reason: `Return after day one is ${formatRate(ret.rate)} against a ${formatRate(
        ret.hypothesis
      )} hypothesis. Fix the daily loop before widening intake — more users would only reveal the same gap at a larger cost.`,
    };
  }

  if (windowDays < 28) {
    return {
      canExpand: false,
      reason: `Return meets the hypothesis, but only ${windowDays} days are in view. The beta rule is four weeks of evidence before expansion.`,
    };
  }

  return {
    canExpand: true,
    reason:
      "Return after day one meets the hypothesis over a four-week window. Check cost per retained payer before spending on acquisition.",
  };
}

function formatRate(r: number | null): string {
  return r === null ? "—" : `${Math.round(r * 100)}%`;
}
