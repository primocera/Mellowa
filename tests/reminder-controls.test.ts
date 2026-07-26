import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLIENT_EVENTS } from "@/lib/analytics/taxonomy";

/**
 * MW-S08: consent-based reminders — preview before opt-in, one-tap controls,
 * plan-state relevance and no sensitive content in email.
 */

const cron = readFileSync("src/app/api/cron/daily-reminders/route.ts", "utf8");
const planner = readFileSync("src/lib/email/reminder-planner.ts", "utf8");
const prefs = readFileSync("src/components/dailyflow/plan-preferences-form.tsx", "utf8");
const checkin = readFileSync("src/components/dailyflow/checkin-form.tsx", "utf8");

describe("reminder setup", () => {
  it("shows the example subject/body before consent and records a version", () => {
    expect(prefs).toContain("Example of the email you");
    expect(prefs).toContain("A gentle nudge from Mellowa");
    expect(prefs).toContain("REMINDER_CONSENT_VERSION");
    expect(prefs).toContain("reminder_consent_version");
  });

  it("offers pause and skip-today as one-tap controls", () => {
    expect(prefs).toContain("Pause reminders");
    expect(prefs).toContain("Skip today");
  });

  it("reminder lifecycle events are client claims with no schedule content", () => {
    for (const e of [
      "reminder_enabled",
      "reminder_paused",
      "reminder_disabled",
      "reminder_link_opened",
    ] as const) {
      expect(CLIENT_EVENTS.has(e), e).toBe(true);
    }
  });
});

describe("reminder delivery", () => {
  it("only nudges users who have no plan for their local date (relevance)", () => {
    expect(cron).toContain('from("daily_plans")');
    expect(cron).toMatch(/hasPlan/);
  });

  it("email content is generic — no mood, meals, journal or plan text", () => {
    const emailHtml = cron.slice(cron.indexOf("subject:"), cron.indexOf("</div>`"));
    expect(emailHtml).not.toMatch(/mood|stress|energy|meal|journal|allerg/i);
    expect(emailHtml).toMatch(/turn these reminders off any time/i);
  });

  it("links back to the authenticated app with a schedule-category marker", () => {
    expect(cron).toContain("/check-in?from=reminder");
    expect(checkin).toContain("reminder_link_opened");
  });

  it("stays idempotent per user and local day via the ledger event key", () => {
    // MW-V10-05: the key is produced by the planner (reminderDedupeKey) so no
    // caller can invent a variant — a divergent key is a duplicate email.
    expect(cron).toContain("eventKey: r.dedupeKey");
    expect(planner).toContain("`daily_reminder:${userId}:${localDate}`");
  });

  it("selects the pause/skip columns so user controls reach the planner", () => {
    expect(cron).toContain("reminders_paused");
    expect(cron).toContain("reminder_skip_date");
  });
});
