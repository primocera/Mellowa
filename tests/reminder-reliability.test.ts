import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  REMINDER_CONSENT_VERSION,
  REMINDER_TIMING_DISCLOSURE,
  canNudgeForBillingState,
  planReminders,
  reminderDedupeKey,
  type ReminderProfile,
} from "@/lib/email/reminder-planner";
import { emailHealth } from "@/lib/analytics/metrics";
import { entitlementFor } from "@/lib/stripe/plans";

/**
 * MW-V10-05: reminder, timezone and lifecycle reliability.
 *
 * The failures this guards against are the ones that destroy trust silently: a
 * nudge to someone in crisis, a nudge to someone who cannot generate a plan, a
 * reminder sent under consent the user never gave, two emails for one day, and
 * a promise about timing the infrastructure cannot keep.
 */

/** A profile that is fully eligible; each test breaks exactly one thing. */
function eligible(over: Partial<ReminderProfile> = {}): ReminderProfile {
  return {
    user_id: "u1",
    reminder_time: "08:00",
    quiet_hours_start: null,
    quiet_hours_end: null,
    timezone: "Europe/Ljubljana",
    last_reminder_sent_date: null,
    reminders_paused: false,
    reminder_skip_date: null,
    reminder_consent_version: REMINDER_CONSENT_VERSION,
    subscription_status: "active",
    safety_suppressed: false,
    ...over,
  };
}

/** 06:00 UTC = 08:00 local in Ljubljana in summer (CEST, UTC+2). */
const SUMMER_MORNING = new Date("2026-07-15T05:00:00Z"); // 07:00 local

describe("consent is enforced, not merely recorded", () => {
  it("sends for the current consent version", () => {
    const plan = planReminders([eligible()], SUMMER_MORNING);
    expect(plan.toDeliver).toHaveLength(1);
  });

  it("refuses when the user consented to older copy", () => {
    const plan = planReminders(
      [eligible({ reminder_consent_version: "2020-01" })],
      SUMMER_MORNING
    );
    expect(plan.toDeliver).toHaveLength(0);
    expect(plan.staleConsent).toBe(1);
  });

  it("fails closed when no consent version was ever recorded", () => {
    for (const version of [null, undefined, ""]) {
      const plan = planReminders(
        [eligible({ reminder_consent_version: version })],
        SUMMER_MORNING
      );
      expect(plan.toDeliver, String(version)).toHaveLength(0);
      expect(plan.staleConsent).toBe(1);
    }
  });

  it("keeps the value that existing users already consented to", () => {
    // Bumping this silently switches reminders off for everyone opted in. That
    // may be correct one day, but it must never happen by accident.
    expect(REMINDER_CONSENT_VERSION).toBe("2026-07");
  });

  it("is defined in exactly one place", () => {
    const form = readFileSync(
      "src/components/dailyflow/plan-preferences-form.tsx",
      "utf8"
    );
    expect(form).toContain("REMINDER_CONSENT_VERSION");
    // The form imports it; it must not declare a second copy.
    expect(form).not.toMatch(/const REMINDER_CONSENT_VERSION\s*=/);
  });
});

describe("safety suppression outranks every other rule", () => {
  it("never nudges a user with a recent safety signal", () => {
    const plan = planReminders([eligible({ safety_suppressed: true })], SUMMER_MORNING);
    expect(plan.toDeliver).toHaveLength(0);
    expect(plan.safetySuppressed).toBe(1);
  });

  it("suppresses even when every other setting says send", () => {
    const plan = planReminders(
      [
        eligible({
          safety_suppressed: true,
          reminders_paused: false,
          reminder_skip_date: null,
          subscription_status: "active",
          reminder_consent_version: REMINDER_CONSENT_VERSION,
        }),
      ],
      SUMMER_MORNING
    );
    expect(plan.toDeliver).toHaveLength(0);
  });

  it("is checked first, so no later rule can decide to send", () => {
    const src = readFileSync("src/lib/email/reminder-planner.ts", "utf8");
    const body = src.slice(src.indexOf("for (const p of profiles)"));
    const safetyAt = body.indexOf("p.safety_suppressed");
    const consentAt = body.indexOf("reminder_consent_version !==");
    const deliverAt = body.indexOf("plan.toDeliver.push");
    expect(safetyAt).toBeGreaterThan(-1);
    expect(safetyAt).toBeLessThan(consentAt);
    expect(safetyAt).toBeLessThan(deliverAt);
  });
});

describe("billing state and reminders never conflict", () => {
  it("does not nudge a user who cannot generate a plan", () => {
    for (const status of ["past_due", "unpaid", "canceled"]) {
      // Precondition: these really are the statuses that cannot generate.
      expect(entitlementFor(status).generate, status).toBe(false);
      const plan = planReminders([eligible({ subscription_status: status })], SUMMER_MORNING);
      expect(plan.toDeliver, status).toHaveLength(0);
      expect(plan.billingState).toBe(1);
    }
  });

  it("still nudges trialing, active and pre-trial users", () => {
    for (const status of ["trialing", "active", "none", "incomplete", null]) {
      const plan = planReminders([eligible({ subscription_status: status })], SUMMER_MORNING);
      expect(plan.toDeliver, String(status)).toHaveLength(1);
    }
  });

  it("agrees with the entitlement matrix on who can generate", () => {
    // A user who can generate must be nudgeable; nudging someone who cannot is
    // an upsell dressed as a wellbeing reminder.
    for (const status of ["trialing", "active", "past_due", "unpaid", "canceled"]) {
      expect(canNudgeForBillingState(status), status).toBe(
        entitlementFor(status).generate
      );
    }
  });
});

describe("timezones and DST", () => {
  const at = (iso: string) => new Date(iso);

  it("schedules for the user's local wall-clock time, not a fixed UTC offset", () => {
    // 05:00Z = 07:00 local (CEST). 08:00 local is still ahead → scheduled.
    const plan = planReminders([eligible()], at("2026-07-15T05:00:00Z"));
    expect(plan.toDeliver[0].scheduledAt).toBe("2026-07-15T06:00:00.000Z");
  });

  it("moves the UTC instant across a DST boundary, not the user's time", () => {
    // Winter (CET, UTC+1): the same 08:00 local is 07:00Z, an hour later in UTC
    // than in summer. The user's experience is identical; the instant is not.
    const winter = planReminders([eligible()], at("2026-01-15T05:00:00Z"));
    expect(winter.toDeliver[0].scheduledAt).toBe("2026-01-15T07:00:00.000Z");

    const summer = planReminders([eligible()], at("2026-07-15T05:00:00Z"));
    expect(summer.toDeliver[0].scheduledAt).toBe("2026-07-15T06:00:00.000Z");
    expect(winter.toDeliver[0].scheduledAt).not.toBe(summer.toDeliver[0].scheduledAt);
  });

  it("sends at most once per local date across repeated runs", () => {
    const profile = eligible();
    const runs = [
      "2026-07-15T05:00:00Z",
      "2026-07-15T06:30:00Z",
      "2026-07-15T09:00:00Z",
      "2026-07-15T18:00:00Z",
    ];
    let sentDate: string | null = null;
    let sends = 0;
    for (const iso of runs) {
      const plan = planReminders(
        [{ ...profile, last_reminder_sent_date: sentDate }],
        at(iso)
      );
      if (plan.toDeliver.length) {
        sends += 1;
        sentDate = plan.toDeliver[0].localDate;
      }
    }
    expect(sends).toBe(1);
  });

  it("never mis-times a send for an invalid stored timezone", () => {
    const plan = planReminders([eligible({ timezone: "Not/AZone" })], SUMMER_MORNING);
    expect(plan.toDeliver).toHaveLength(0);
    expect(plan.invalidTimezones).toBe(1);
  });

  it("respects a quiet window that wraps midnight", () => {
    // 23:00 local, quiet 21:00→07:00, no future reminder time left today.
    const plan = planReminders(
      [
        eligible({
          reminder_time: "07:00",
          quiet_hours_start: "21:00",
          quiet_hours_end: "07:00",
        }),
      ],
      at("2026-07-15T21:00:00Z") // 23:00 local
    );
    expect(plan.toDeliver).toHaveLength(0);
    expect(plan.inQuietHours).toBe(1);
  });
});

describe("pause, skip and dedupe", () => {
  it("pause stops the next send", () => {
    const plan = planReminders([eligible({ reminders_paused: true })], SUMMER_MORNING);
    expect(plan.toDeliver).toHaveLength(0);
    expect(plan.pausedOrSkipped).toBe(1);
  });

  it("skip-today stops only that local date", () => {
    const today = planReminders(
      [eligible({ reminder_skip_date: "2026-07-15" })],
      SUMMER_MORNING
    );
    expect(today.toDeliver).toHaveLength(0);

    const tomorrow = planReminders(
      [eligible({ reminder_skip_date: "2026-07-15" })],
      new Date("2026-07-16T05:00:00Z")
    );
    expect(tomorrow.toDeliver).toHaveLength(1);
  });

  it("the planner owns the dedupe key, so no caller can invent a variant", () => {
    const plan = planReminders([eligible()], SUMMER_MORNING);
    expect(plan.toDeliver[0].dedupeKey).toBe(
      reminderDedupeKey("u1", "2026-07-15")
    );
    const route = readFileSync(
      "src/app/api/cron/daily-reminders/route.ts",
      "utf8"
    );
    expect(route).toContain("eventKey: r.dedupeKey");
    // No hand-built key left at the call site.
    expect(route).not.toMatch(/eventKey: `daily_reminder:/);
  });

  it("is stable — the same user and date always produce the same key", () => {
    expect(reminderDedupeKey("u1", "2026-07-15")).toBe(
      reminderDedupeKey("u1", "2026-07-15")
    );
    expect(reminderDedupeKey("u1", "2026-07-15")).not.toBe(
      reminderDedupeKey("u1", "2026-07-16")
    );
  });
});

describe("cron runs are lease-protected as well as idempotent", () => {
  const route = readFileSync("src/app/api/cron/daily-reminders/route.ts", "utf8");
  const lease = readFileSync("src/lib/cron-lease.ts", "utf8");
  const migration = readFileSync(
    "supabase/migrations/038_mellowa_v10_cron_leases.sql",
    "utf8"
  );

  it("a second overlapping run is a no-op", () => {
    expect(route).toContain("acquireCronLease");
    expect(route).toContain('skipped: "already_running"');
  });

  it("releases the lease so the next trigger is not blocked for the full TTL", () => {
    expect(route).toContain("lease.release()");
  });

  it("fails OPEN, so a lease problem cannot silently stop all reminders", () => {
    expect(lease).toMatch(/fail(ing)? open/i);
    expect(lease).toContain("acquired: true");
  });

  it("expires on its own, so a crashed run cannot wedge the job", () => {
    expect(migration).toMatch(/leased_until < now\(\)/);
  });

  it("acquires atomically, so two simultaneous runs cannot both win", () => {
    expect(migration).toMatch(/on conflict \(job_name\) do update/i);
  });

  it("keeps duplicate-send protection independent of the lease", () => {
    // The ledger event key is the real guarantee; the lease only saves work.
    expect(lease).toMatch(/Idempotency does not\s+\*?\s*depend on the lease/i);
  });
});

describe("reminder content stays generic and non-shaming", () => {
  const route = readFileSync("src/app/api/cron/daily-reminders/route.ts", "utf8");
  const templates = readFileSync("src/lib/email/templates.ts", "utf8");

  it("uses no guilt, streak or catch-up language", () => {
    const text = `${route} ${templates}`.toLowerCase();
    for (const banned of [
      "you missed",
      "get back on track",
      "don't break",
      "streak",
      "you haven't",
      "falling behind",
      "keep it up",
      "you forgot",
    ]) {
      expect(text, `reminder copy contains "${banned}"`).not.toContain(banned);
    }
  });

  it("carries no wellbeing content in the subject or body", () => {
    for (const sensitive of ["mood", "energy_level", "journal", "allerg", "calorie"]) {
      // The reminder HTML in the cron route must not interpolate any of these.
      const reminderBlock = route.slice(
        route.indexOf("A gentle nudge from Mellowa"),
        route.indexOf("A gentle nudge from Mellowa") + 900
      );
      expect(reminderBlock.toLowerCase()).not.toContain(sensitive);
    }
  });

  it("always offers a working opt-out from inside the email", () => {
    expect(route).toContain("unsubscribeUrl");
    expect(route).toMatch(/Turn these reminders off/);
  });
});

describe("timing is disclosed honestly", () => {
  it("never promises a minute the infrastructure cannot hit", () => {
    expect(REMINDER_TIMING_DISCLOSURE).toMatch(/never arrive before it/i);
    expect(REMINDER_TIMING_DISCLOSURE).toMatch(/later in the day/i);
    expect(REMINDER_TIMING_DISCLOSURE).toMatch(/at most one/i);
  });

  it("is shown in settings, next to the time picker", () => {
    const form = readFileSync(
      "src/components/dailyflow/plan-preferences-form.tsx",
      "utf8"
    );
    expect(form).toContain("REMINDER_TIMING_DISCLOSURE");
    expect(form).toMatch(/Never earlier than this; sometimes later in the day/);
  });

  it("documents the Vercel Hobby limitation for operators", () => {
    const doc = readFileSync("docs/ops-cron.md", "utf8");
    expect(doc).toMatch(/Hobby/);
    expect(doc.toLowerCase()).toMatch(/window|not a to-the-minute|guarantee/);
  });
});

describe("email health is observable without reading anyone's mail", () => {
  const rows = [
    { status: "sent", template: "daily_reminder", attempts: 1, created_at: "2026-07-15T00:00:00Z" },
    { status: "sent", template: "trial_started", attempts: 1, created_at: "2026-07-15T00:00:00Z" },
    { status: "failed_transient", template: "daily_reminder", attempts: 2, created_at: "2026-07-14T00:00:00Z" },
    { status: "failed_permanent", template: "daily_reminder", attempts: 5, created_at: "2026-07-13T00:00:00Z" },
    { status: "not_configured", template: "payment_failed", attempts: 0, created_at: "2026-07-15T06:00:00Z" },
  ];
  const now = new Date("2026-07-15T12:00:00Z");

  it("separates backlog from dead letters", () => {
    const h = emailHealth(rows, now);
    expect(h.backlog).toBe(2); // transient + not_configured
    expect(h.deadLetter).toBe(1);
    expect(h.deadLetterByTemplate).toEqual({ daily_reminder: 1 });
  });

  it("reports the age of the oldest stuck item", () => {
    const h = emailHealth(rows, now);
    expect(h.oldestBacklogHours).toBe(36); // 14th 00:00 → 15th 12:00
  });

  it("reports a delivery rate over attempted messages only", () => {
    expect(emailHealth(rows, now).deliveryRate).toBe(0.667);
    expect(emailHealth([], now).deliveryRate).toBeNull();
  });

  it("never touches recipient or content fields", () => {
    const report = readFileSync("src/lib/analytics/report.ts", "utf8");
    const select = report.slice(
      report.indexOf('from("email_deliveries")'),
      report.indexOf('from("email_deliveries")') + 240
    );
    for (const field of ["to_email", "subject", "html"]) {
      expect(select, `report selects ${field}`).not.toContain(field);
    }
  });

  it("is surfaced to the owner in the admin dashboard", () => {
    const admin = readFileSync("src/app/admin/page.tsx", "utf8");
    expect(admin).toContain("r.email.backlog");
    expect(admin).toContain("r.email.deadLetter");
  });
});
