/** Plan definitions and simple MVP usage limits. Shared client/server. */

export type PlanTier = "free" | "pro";

export type PremiumFeature =
  | "weekly_plan"
  | "meal_rhythm"
  | "journal_reflection"
  | "progress_insight";

export const PLAN_LIMITS = {
  free: {
    dailyPlansPerMonth: 5,
    weeklyPlansPerMonth: 1,
    premiumFeatures: [] as PremiumFeature[],
  },
  pro: {
    dailyPlansPerMonth: 500, // effectively unlimited, reasonable ceiling
    weeklyPlansPerMonth: 60,
    premiumFeatures: [
      "weekly_plan",
      "meal_rhythm",
      "journal_reflection",
      "progress_insight",
    ] as PremiumFeature[],
  },
} as const;

/** A subscription counts as active for these Stripe statuses. */
export const ACTIVE_STATUSES = ["active", "trialing", "past_due"];

export const PRICING = {
  free: {
    name: "Free",
    price: "$0",
    cadence: "",
    features: [
      "Daily check-in",
      "Up to 5 daily plans / month",
      "Basic habit tracking",
    ],
  },
  monthly: {
    name: "Premium Monthly",
    price: "$9",
    cadence: "/month",
    features: [
      "Personalized daily plans",
      "Weekly plans & shopping lists",
      "Meal rhythm ideas",
      "Journal prompts & reflection",
      "Progress insights",
    ],
  },
  yearly: {
    name: "Premium Annual",
    price: "$79",
    cadence: "/year",
    features: [
      "Everything in Premium Monthly",
      "Two months free vs. monthly",
    ],
  },
} as const;
