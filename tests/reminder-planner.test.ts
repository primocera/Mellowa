import { describe, expect, it } from "vitest";
import {
  planReminders,
  inQuietHours,
  toMinutes,
  chunk,
  type ReminderProfile,
} from "@/lib/email/reminder-planner";

/** Scalable jobs (Launch v6, Prompt 15) — pure planner + batching helpers. */

function profile(overrides: Partial<ReminderProfile>): ReminderProfile {
  return {
    user_id: "u1",
    reminder_time: "09:00",
    quiet_hours_start: null,
    quiet_hours_end: null,
    timezone: "UTC",
    last_reminder_sent_date: null,
    ...overrides,
  };
}

// Fixed instant: 2026-07-17 10:30 UTC
const NOW = new Date("2026-07-17T10:30:00Z");

describe("planReminders", () => {
  it("sends immediately when the preferred time already passed (outside quiet hours)", () => {
    const plan = planReminders([profile({})], NOW);
    expect(plan.toDeliver).toHaveLength(1);
    expect(plan.toDeliver[0].scheduledAt).toBeUndefined();
    expect(plan.toDeliver[0].localDate).toBe("2026-07-17");
  });

  it("schedules for later when the preferred time is still ahead", () => {
    const plan = planReminders([profile({ reminder_time: "18:00" })], NOW);
    expect(plan.toDeliver[0].scheduledAt).toBe("2026-07-17T18:00:00.000Z");
  });

  it("skips users already reminded today (duplicate-delivery guard)", () => {
    const plan = planReminders(
      [profile({ last_reminder_sent_date: "2026-07-17" })],
      NOW
    );
    expect(plan.toDeliver).toHaveLength(0);
    expect(plan.alreadySent).toBe(1);
  });

  it("skips (not schedules) inside a midnight-wrapping quiet window", () => {
    const plan = planReminders(
      [profile({ reminder_time: "06:00", quiet_hours_start: "22:00", quiet_hours_end: "11:00" })],
      NOW
    );
    expect(plan.toDeliver).toHaveLength(0);
    expect(plan.inQuietHours).toBe(1);
  });

  it("counts invalid timezones instead of mis-timing", () => {
    const plan = planReminders([profile({ timezone: "Not/AZone" })], NOW);
    expect(plan.toDeliver).toHaveLength(0);
    expect(plan.invalidTimezones).toBe(1);
  });

  it("MW-S08: paused profiles are never delivered, effective immediately", () => {
    const plan = planReminders([profile({ reminders_paused: true })], NOW);
    expect(plan.toDeliver).toHaveLength(0);
    expect(plan.pausedOrSkipped).toBe(1);
  });

  it("MW-S08: skip-today suppresses only the matching local date", () => {
    const skippedToday = planReminders(
      [profile({ reminder_skip_date: "2026-07-17" })],
      NOW
    );
    expect(skippedToday.toDeliver).toHaveLength(0);
    expect(skippedToday.pausedOrSkipped).toBe(1);
    const skippedYesterday = planReminders(
      [profile({ reminder_skip_date: "2026-07-16" })],
      NOW
    );
    expect(skippedYesterday.toDeliver).toHaveLength(1);
  });

  it("MW-S08: pause wins even when a send would otherwise be scheduled", () => {
    const plan = planReminders(
      [profile({ reminders_paused: true, reminder_time: "18:00" })],
      NOW
    );
    expect(plan.toDeliver).toHaveLength(0);
  });

  it("plans 10,000 synthetic profiles quickly with correct dedupe", () => {
    const profiles: ReminderProfile[] = [];
    for (let i = 0; i < 10_000; i++) {
      profiles.push(
        profile({
          user_id: `u${i}`,
          // every 4th user already reminded today
          last_reminder_sent_date: i % 4 === 0 ? "2026-07-17" : null,
        })
      );
    }
    const t0 = Date.now();
    const plan = planReminders(profiles, NOW);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(plan.toDeliver).toHaveLength(7500);
    expect(plan.alreadySent).toBe(2500);
    // No duplicates within the plan itself
    expect(new Set(plan.toDeliver.map((r) => r.userId)).size).toBe(7500);
  });
});

describe("helpers", () => {
  it("toMinutes parses HH:MM and rejects junk", () => {
    expect(toMinutes("09:30")).toBe(570);
    expect(toMinutes(null)).toBeNull();
    expect(toMinutes("junk")).toBeNull();
  });

  it("inQuietHours handles plain and midnight-wrapping windows", () => {
    expect(inQuietHours(600, "08:00", "12:00")).toBe(true);
    expect(inQuietHours(600, "22:00", "07:00")).toBe(false);
    expect(inQuietHours(60, "22:00", "07:00")).toBe(true);
    expect(inQuietHours(600, null, "12:00")).toBe(false);
  });

  it("chunk splits into RPC-batch sizes", () => {
    const parts = chunk(Array.from({ length: 1201 }, (_, i) => i), 500);
    expect(parts.map((p) => p.length)).toEqual([500, 500, 201]);
    expect(chunk([], 500)).toEqual([]);
  });
});
