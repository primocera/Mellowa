import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMAIL_CATEGORIES, isOptionalEmail } from "@/lib/email/categories";
import * as templates from "@/lib/email/templates";

process.env.NEXT_PUBLIC_APP_URL ??= "https://mellowa.app";

/** Lifecycle messaging (Launch v6, Prompt 19). */

describe("category registry", () => {
  it("classifies every template used by a deliverEmail call site", () => {
    // Every `template: "<name>"` string across the codebase must be registered.
    const files = [
      "src/app/api/stripe/webhook/route.ts",
      "src/app/api/stripe/cancel/route.ts",
      "src/app/api/account/delete/route.ts",
      "src/app/api/ai/daily-plan/route.ts",
      "src/app/api/cron/daily-reminders/route.ts",
      "src/app/api/cron/trial-reminders/route.ts",
      "src/app/api/email/welcome/route.ts",
      "src/app/auth/callback/route.ts",
    ];
    const used = new Set<string>();
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/template:\s*"([a-z_]+)"/g)) used.add(m[1]);
    }
    for (const t of used) {
      expect(t in EMAIL_CATEGORIES, `template "${t}" missing from EMAIL_CATEGORIES`).toBe(true);
    }
  });

  it("billing and security email is transactional; nudges are optional", () => {
    for (const t of [
      "verify", "trial_started", "trial_ending", "trial_ended",
      "canceled", "payment_failed", "payment_recovered", "account_deleted",
    ]) {
      expect(isOptionalEmail(t), `${t} must be transactional`).toBe(false);
    }
    expect(isOptionalEmail("daily_reminder")).toBe(true);
    expect(isOptionalEmail("onboarding_nudge")).toBe(true);
  });
});

describe("required customer-facing copy", () => {
  it("trial ending states the exact charge sentence", () => {
    const { html } = templates.trialEndingEmail({
      plan: "Mellowa Monthly",
      price: "€9.99",
      date: "18 August 2026",
    });
    expect(html).toContain(
      "Your Mellowa Monthly trial ends on 18 August 2026. You'll be charged €9.99 on that date unless you cancel first."
    );
  });

  it("cancellation states access-until date and no further charges", () => {
    const { html } = templates.canceledEmail({ date: "1 September 2026" });
    expect(html).toContain("until 1 September 2026");
    expect(html).toContain("You won't be charged again");
  });
});

describe("no sensitive profiling in any email", () => {
  it("templates never mention mood, stress, allergies, meals skipped or journal", () => {
    const src = readFileSync("src/lib/email/templates.ts", "utf8").toLowerCase();
    for (const forbidden of ["mood", "stress", "allerg", "journal", "skipped meal"]) {
      // The privacy doc-comment names the rule; strip comments before scanning.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      expect(code.includes(forbidden), `templates must not mention "${forbidden}"`).toBe(false);
    }
  });

  it("state eligibility never reads wellbeing content tables", () => {
    for (const f of [
      "src/app/api/cron/daily-reminders/route.ts",
      "src/app/api/cron/trial-reminders/route.ts",
    ]) {
      const src = readFileSync(f, "utf8");
      for (const table of ["journal_entries", "daily_checkins", "meal_ideas"]) {
        expect(src.includes(table), `${f} must not read ${table}`).toBe(false);
      }
    }
  });
});

describe("suppression and one-shot guarantees", () => {
  it("onboarding nudge is once-ever and suppressed once a profile exists", () => {
    const src = readFileSync("src/app/api/cron/daily-reminders/route.ts", "utf8");
    expect(src).toContain("`onboarding_nudge:${userId}`"); // no date → once ever
    expect(src).toContain("wellbeing_profiles"); // profile existence suppresses
  });

  it("deletion confirmation and event are recorded ONLY after the identity is deleted and verified (MW-V18-04 state machine)", () => {
    // MW-V18-04 moved the ordering guarantee out of the request handler and into
    // the durable state machine, which is the single source of truth. The
    // invariant is unchanged: cancel an owned sub before deleting the identity,
    // verify the identity is gone before queuing the email, and record the
    // completion event last. Enforced here by the step order in machine.ts.
    const src = readFileSync("src/lib/account-deletion/machine.ts", "utf8");
    const ownershipAt = src.indexOf("deps.verifyOwnership(");
    const cancelAt = src.indexOf("deps.cancelSubscription(");
    const deleteAt = src.indexOf("deps.deleteAuthUser(userId)");
    const verifyAt = src.indexOf("deps.getUserById(userId)");
    const emailAt = src.indexOf("deps.queueNotification({");
    const eventAt = src.indexOf("deps.recordCompletedEvent()");
    // ownership → cancel → delete → verify → email → event, in that order.
    expect(ownershipAt).toBeGreaterThan(0);
    expect(cancelAt).toBeGreaterThan(ownershipAt);
    expect(deleteAt).toBeGreaterThan(cancelAt);
    expect(verifyAt).toBeGreaterThan(deleteAt);
    expect(emailAt).toBeGreaterThan(verifyAt);
    expect(eventAt).toBeGreaterThan(emailAt);

    // And the confirmation email / event helpers really are wired to the
    // deletion path (in the worker's default deps), not left dangling.
    const worker = readFileSync("src/lib/account-deletion/worker.ts", "utf8");
    expect(worker).toContain("accountDeletedEmail");
    expect(worker).toContain('trackEvent("account_deleted"');
    expect(worker).toContain('template: "account_deleted"');
  });

  it("sample-ready email can only ever send once per user", () => {
    const src = readFileSync("src/app/api/ai/daily-plan/route.ts", "utf8");
    expect(src).toContain("`sample_ready:${user.id}`");
  });
});
