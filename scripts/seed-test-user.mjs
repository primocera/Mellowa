// Local-only: create a confirmed test user with a wellbeing profile and an
// active trial subscription, so you can log in and test without email confirm.
// Run: node scripts/seed-test-user.mjs
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

// 3. Trial subscription → unlocks premium features.
const trialEnd = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
const { error: subErr } = await admin.from("subscriptions").upsert(
  {
    user_id: userId,
    plan_name: "premium",
    status: "trialing",
    trial_start: new Date().toISOString(),
    trial_end: trialEnd,
    current_period_end: trialEnd,
    cancel_at_period_end: false,
  },
  { onConflict: "user_id" }
);
if (subErr) console.error("subscriptions:", subErr.message);

console.log("\n✅ Test user ready:");
console.log("   Email:    " + EMAIL);
console.log("   Password: " + PASSWORD);
console.log("   Status:   trialing (premium unlocked, 3-day trial)\n");
