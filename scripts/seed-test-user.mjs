// Local-only: create a confirmed test user with a wellbeing profile and an
// active trial subscription, so you can log in and test without email confirm.
// Run: node scripts/seed-test-user.mjs
//
// MW-V10-03: the daily-journey states a unit test cannot reach are seeded here,
// one at a time, so the Playwright matrix can assert each one against the real
// app. Pick one with --state (default `plan-ready`):
//
//   no-plan       no daily plan for today → the check-in entry state
//   plan-ready    a full plan, nothing completed
//   partly-done   a full plan with one item already completed
//   all-done      every completable item marked done → the "that's everything" state
//   past-due      trial/active gone to past_due → read-only + recovery route
//   canceled      subscription ended → read-only + recovery route
//   ending        trialing but set not to renew → the info recovery notice
//   bad-timezone  an invalid stored IANA zone → the timezone repair prompt
//   trial-eligible  no subscription row at all → checkout may offer a trial
//   trial-used      trial spent, subscription ended → pay-today copy only
//
// Every state is written for the SAME synthetic user, so switching states never
// leaves rows from a previous state behind: the plan and its completions are
// deleted and rebuilt on each run.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// Minimal .env.local loader (no dependency on dotenv).
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing Supabase env vars in .env.local");
  process.exit(1);
}

// Credentials the Playwright journeys suite logs in with. Overridable via env
// so the seed and the test read the exact same values (E2E_TEST_EMAIL /
// E2E_TEST_PASSWORD). This user is a clearly-labelled synthetic account; RLS
// isolates its rows, so it is safe to seed even in the single live project.
const EMAIL = env.E2E_TEST_EMAIL || "test@mellowa.local";
const PASSWORD = env.E2E_TEST_PASSWORD || "Mellowa123!";

// MW-V10-03: which daily-journey state to seed. An unknown value is a typo, not
// a request for the default — fail rather than silently seeding something else.
const VALID_STATES = [
  "no-plan",
  "plan-ready",
  "partly-done",
  "all-done",
  "past-due",
  "canceled",
  "ending",
  "bad-timezone",
  // MW-V11-04: the two billing states no fixture could produce. Every state
  // above writes a `subscriptions` row with status `trialing` or later, so a
  // trial-eligible user and a prior-trial user were both unreachable — and the
  // two journeys.spec.ts tests that need them skipped on every run since they
  // were written. A skip reads as a decision, so nothing ever reported it.
  "trial-eligible",
  "trial-used",
];
const STATE =
  process.argv.find((a) => a.startsWith("--state="))?.split("=")[1] ??
  env.E2E_SEED_STATE ??
  "plan-ready";
if (!VALID_STATES.includes(STATE)) {
  console.error(
    `Unknown --state=${STATE}. Valid states: ${VALID_STATES.join(", ")}`
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// 1. Create (or find) the confirmed user.
let userId;
const created = await admin.auth.admin.createUser({
  email: EMAIL,
  password: PASSWORD,
  email_confirm: true,
});

if (created.error) {
  if (/already been registered|already exists/i.test(created.error.message)) {
    const { data } = await admin.auth.admin.listUsers();
    userId = data.users.find((u) => u.email === EMAIL)?.id;
    // Reset password so the known password always works.
    if (userId) {
      await admin.auth.admin.updateUserById(userId, {
        password: PASSWORD,
        email_confirm: true,
      });
    }
    console.log("User already existed — password reset.");
  } else {
    console.error("createUser failed:", created.error.message);
    process.exit(1);
  }
} else {
  userId = created.data.user.id;
  console.log("Created new user.");
}

if (!userId) {
  console.error("Could not resolve user id.");
  process.exit(1);
}

// 2. Wellbeing profile (so onboarding is considered done).
const { error: profErr } = await admin.from("wellbeing_profiles").upsert(
  {
    user_id: userId,
    age_range: "25-34",
    primary_goal: "More steady energy",
    wake_time: "07:00",
    sleep_time: "23:00",
    work_schedule: "9-5 office",
    food_preferences: ["quick", "vegetarian-friendly"],
    allergies: [],
    cooking_time: "20-30 min",
    budget_level: "medium",
    movement_level: "light",
    sleep_quality_baseline: "ok",
    stress_baseline: "medium",
    supplement_use: "none",
    preferred_tone: "warm",
    safety_acknowledged: true,
  },
  { onConflict: "user_id" }
);
if (profErr) console.error("wellbeing_profiles:", profErr.message);

// 2b. MW-V10-03: the timezone the profile stores decides whether Today shows
// the repair prompt. Written after the profile so one flag controls it.
if (STATE === "bad-timezone") {
  await admin
    .from("wellbeing_profiles")
    .update({ timezone: "Not/AZone" })
    .eq("user_id", userId);
} else {
  await admin
    .from("wellbeing_profiles")
    .update({ timezone: "Europe/Ljubljana" })
    .eq("user_id", userId);
}

// 3. Subscription state. Read access is never revoked in any of these — the
// entitlement matrix keeps `read: true` for every status, and the states exist
// to prove the UI says so.
const trialEnd = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
const SUBSCRIPTION_STATES = {
  "past-due": { status: "past_due", cancel_at_period_end: false },
  canceled: { status: "canceled", cancel_at_period_end: false },
  ending: { status: "trialing", cancel_at_period_end: true },
};
const subState = SUBSCRIPTION_STATES[STATE] ?? {
  status: "trialing",
  cancel_at_period_end: false,
};

if (STATE === "trial-eligible") {
  // No subscription row at all: this is a signed-up user who has never paid and
  // has never started a trial, so checkout must offer one. `trialEligible` in
  // the checkout route is `!sub?.trial_used_at`, and the pricing page shows the
  // trial CTA only in this state.
  const { error: delErr } = await admin
    .from("subscriptions")
    .delete()
    .eq("user_id", userId);
  if (delErr) console.error("subscriptions delete:", delErr.message);
} else if (STATE === "trial-used") {
  // The one lifetime trial is spent and the subscription has ended. This is the
  // state that must show pay-today copy and no cancel-by date — the exact
  // combination the billing page got wrong before MW-V10-02.
  const { error: usedErr } = await admin.from("subscriptions").upsert(
    {
      user_id: userId,
      plan_name: "pro_monthly",
      status: "canceled",
      trial_start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      trial_end: new Date(Date.now() - 27 * 24 * 60 * 60 * 1000).toISOString(),
      current_period_end: new Date(Date.now() - 27 * 24 * 60 * 60 * 1000).toISOString(),
      cancel_at_period_end: false,
      trial_used_at: new Date(Date.now() - 27 * 24 * 60 * 60 * 1000).toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (usedErr) console.error("subscriptions:", usedErr.message);
} else {
  const { error: subErr } = await admin.from("subscriptions").upsert(
    {
      user_id: userId,
      plan_name: "pro_monthly",
      status: subState.status,
      trial_start: new Date().toISOString(),
      trial_end: trialEnd,
      current_period_end: trialEnd,
      cancel_at_period_end: subState.cancel_at_period_end,
    },
    { onConflict: "user_id" }
  );
  if (subErr) console.error("subscriptions:", subErr.message);
}

// 4. Today's plan. Rebuilt every run so switching states leaves nothing behind.
const localDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: STATE === "bad-timezone" ? "UTC" : "Europe/Ljubljana",
}).format(new Date());

const { data: oldPlans } = await admin
  .from("daily_plans")
  .select("id")
  .eq("user_id", userId);
for (const p of oldPlans ?? []) {
  await admin.from("plan_completions").delete().eq("daily_plan_id", p.id);
}
await admin.from("daily_plans").delete().eq("user_id", userId);

// Deliberately plain, non-sensitive fixture content: no allergen-relevant
// ingredients, no mood or journal text, nothing that reads as real user data.
//
// The shape MUST match MealCardSchema in src/schemas/ai-output-v2.ts exactly.
// The first version of this fixture used `steps` and plain-string ingredients,
// so TodayPlanV2 called `preparation_steps.map()` on undefined and Today threw
// into the error boundary — the state matrix was testing a crash instead of the
// feature. Only running the suite revealed it.
function meal(overrides) {
  return {
    meal_type: "breakfast",
    title: "Oats with fruit",
    short_description: "Made the night before.",
    prep_time_minutes: 5,
    cook_time_minutes: 0,
    total_time_minutes: 5,
    difficulty: "easy",
    budget_level: "low",
    servings: 1,
    ingredients: [
      { name: "oats", amount: "50 g", optional: false },
      { name: "milk of choice", amount: "150 ml", optional: false },
      { name: "fruit", amount: "1 handful", optional: false },
    ],
    preparation_steps: [
      "Combine the oats and milk the night before.",
      "Add the fruit in the morning.",
    ],
    approximate_macros: { calories: 350, protein_g: 12, carbs_g: 55, fat_g: 8 },
    why_it_fits_today: "Nothing to cook and nothing to decide.",
    low_energy_swap: "Eat it cold, straight from the fridge.",
    grocery_items: ["oats", "fruit"],
    safety_note: "Macros are approximate and not medical nutrition advice.",
    ...overrides,
  };
}

const FIXTURE_PLAN = {
  plan_date: localDate,
  plan_mode: "balanced",
  plan_intensity: "normal",
  plan_summary: {
    main_focus: "A steady day with room to breathe",
    energy_match: "Built for a mid-energy day.",
    short_note: "Three anchors and one pause.",
  },
  meal_cards: [
    meal({}),
    meal({
      meal_type: "lunch",
      title: "Grain bowl",
      short_description: "Uses last night's leftovers.",
      prep_time_minutes: 10,
      cook_time_minutes: 0,
      total_time_minutes: 10,
      ingredients: [
        { name: "cooked grains", amount: "1 cup", optional: false },
        { name: "greens", amount: "1 handful", optional: false },
        { name: "leftover protein", amount: "1 portion", optional: false },
      ],
      preparation_steps: ["Combine everything in a bowl.", "Season and eat."],
      approximate_macros: { calories: 480, protein_g: 24, carbs_g: 58, fat_g: 14 },
      low_energy_swap: "Skip the greens.",
    }),
  ],
  hydration_plan_v2: {
    goal: "About 6 glasses through the day",
    timing: ["One with each meal", "One mid-afternoon"],
  },
  movement_plan: {
    title: "A 10-minute walk",
    movement_type: "walk",
    duration_minutes: 10,
    intensity: "gentle",
    best_time: "After lunch",
    equipment_needed: "None",
    steps: ["Step outside.", "Walk at an easy pace for ten minutes."],
    modifications: ["Walk indoors if the weather is bad."],
    low_energy_version: "Stand by an open window for two minutes.",
    caution_note: "Skip any movement that causes pain.",
  },
  breathing_exercise: {
    name: "Three slow breaths",
    duration_minutes: 2,
    when_to_use: "Any point in the day",
    steps: ["In through the nose for four.", "Out slowly for six."],
    gentle_note: "Stop if you feel dizzy or uncomfortable.",
  },
  evening_routine: {
    time: "21:30",
    steps: ["Lights low.", "Screens down."],
    simple_version: "Just dim the lights.",
  },
  habit_focus: {
    habit: "Fill the water bottle",
    minimum_version: "Just fill it.",
    tracking_question: "Did you fill it?",
  },
  encouragement: "One step at a time is enough.",
  safety_note: "This plan is general wellbeing support, not medical advice.",
};

// Keys the app uses for completions, in the same shape as lib/today/next-action.
const ALL_ITEM_KEYS = [
  "meal:breakfast",
  "meal:lunch",
  "movement",
  "breathing",
  "habit",
  "evening",
];

if (STATE !== "no-plan") {
  const { data: planRow, error: planErr } = await admin
    .from("daily_plans")
    .insert({ user_id: userId, ...FIXTURE_PLAN })
    .select("id")
    .single();
  if (planErr) {
    console.error("daily_plans:", planErr.message);
  } else {
    const completed =
      STATE === "all-done"
        ? ALL_ITEM_KEYS
        : STATE === "partly-done"
          ? ["meal:breakfast"]
          : [];
    if (completed.length > 0) {
      const { error: compErr } = await admin.from("plan_completions").insert(
        completed.map((item_key) => ({
          user_id: userId,
          daily_plan_id: planRow.id,
          item_key,
        }))
      );
      if (compErr) console.error("plan_completions:", compErr.message);
    }
  }
}

console.log("\n✅ Test user ready:");
console.log("   Email:    " + EMAIL);
console.log("   Password: " + PASSWORD);
console.log("   State:    " + STATE);
// MW-V11: report what was actually written, not the default that the two
// billing states never use. This line printed "trialing" for `trial-eligible`
// (which deletes the subscription row outright) and for `trial-used` (which
// writes a canceled row with trial_used_at) — so the summary contradicted the
// state it had just seeded, which is exactly the kind of small lie that costs
// an hour when a live test then behaves "wrong".
const reportedStatus =
  STATE === "trial-eligible"
    ? "no subscription row — trial-eligible"
    : STATE === "trial-used"
      ? "canceled, trial_used_at set — pay-today only"
      : subState.status + (subState.cancel_at_period_end ? " (set not to renew)" : "");

console.log(
  "   Status:   " +
    reportedStatus +
    (STATE === "no-plan" ? ", no plan for today" : ", plan seeded for " + localDate) +
    "\n"
);
