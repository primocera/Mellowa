import { describe, it, expect } from "vitest";
import {
  isValidTimeZone,
  localCalendarDaysUntil,
  localDateFor,
  localMinutesFor,
  resolvePlanDate,
  instantForLocalTime,
} from "@/lib/dates/local-day";

// First Intl timezone load can take seconds on cold ICU data.
describe("local-day service (Prompt 9)", { timeout: 20_000 }, () => {
  it("validates IANA timezones", () => {
    expect(isValidTimeZone("Europe/Ljubljana")).toBe(true);
    expect(isValidTimeZone("Pacific/Kiritimati")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
  });

  it("a user near midnight sees the correct local date (UTC±12/14)", () => {
    // 2026-07-16 11:30 UTC → already the 17th on Kiritimati (UTC+14),
    // still the 16th in Ljubljana, and the 16th early morning in Samoa? No —
    // Pacific/Pago_Pago is UTC-11: 00:30 on the 16th.
    const at = new Date("2026-07-16T11:30:00Z");
    expect(localDateFor("Pacific/Kiritimati", at)).toBe("2026-07-17");
    expect(localDateFor("Europe/Ljubljana", at)).toBe("2026-07-16");
    expect(localDateFor("Pacific/Pago_Pago", at)).toBe("2026-07-16");

    // 23:30 UTC → next day in Europe, same day in the US.
    const late = new Date("2026-07-16T23:30:00Z");
    expect(localDateFor("Europe/Ljubljana", late)).toBe("2026-07-17");
    expect(localDateFor("America/Los_Angeles", late)).toBe("2026-07-16");
  });

  it("computes minutes since local midnight", () => {
    const at = new Date("2026-07-16T22:15:00Z"); // 00:15 on the 17th in CEST
    expect(localMinutesFor("Europe/Ljubljana", at)).toBe(15);
  });

  it("resolvePlanDate prefers the stored timezone over the client date", () => {
    const now = new Date("2026-07-16T23:30:00Z");
    expect(
      resolvePlanDate({
        storedTimezone: "Europe/Ljubljana",
        clientDate: "2026-07-16",
        now,
      })
    ).toBe("2026-07-17");
  });

  it("falls back to a bounded client date when no valid timezone", () => {
    const now = new Date("2026-07-16T12:00:00Z");
    expect(
      resolvePlanDate({ storedTimezone: null, clientDate: "2026-07-17", now })
    ).toBe("2026-07-17");
    // Out-of-bounds client date is rejected.
    expect(
      resolvePlanDate({ storedTimezone: "Nope/Nope", clientDate: "2026-07-30", now })
    ).toBe("2026-07-16");
    expect(
      resolvePlanDate({ storedTimezone: null, clientDate: "junk", now })
    ).toBe("2026-07-16");
  });

  it("counts whole local calendar days until a target instant", () => {
    // Ljubljana is CEST (UTC+2) in July. now = 30 Jul 07:00 local.
    const now = new Date("2026-07-30T05:00:00Z");
    // Trial ends 30 Jul 09:00 local — same local day → 0 ("today").
    expect(
      localCalendarDaysUntil("Europe/Ljubljana", new Date("2026-07-30T07:00:00Z"), now)
    ).toBe(0);
    // Trial ends 31 Jul 08:00 local — next local day → 1 ("tomorrow"),
    // even though it is only ~25h away.
    expect(
      localCalendarDaysUntil("Europe/Ljubljana", new Date("2026-07-31T06:00:00Z"), now)
    ).toBe(1);
    // Trial ends 1 Aug local → 2 ("in 2 days").
    expect(
      localCalendarDaysUntil("Europe/Ljubljana", new Date("2026-08-01T06:00:00Z"), now)
    ).toBe(2);
    // Already past → negative.
    expect(
      localCalendarDaysUntil("Europe/Ljubljana", new Date("2026-07-29T06:00:00Z"), now)
    ).toBe(-1);
  });

  it("resolves the day count in the user's zone, not the server's UTC", () => {
    // 30 Jul 22:30 UTC is already 31 Jul in Ljubljana (UTC+2), so a trial
    // ending 31 Jul 00:30 local is "today" there — while a naive UTC reading
    // would call it "tomorrow".
    const now = new Date("2026-07-30T22:30:00Z"); // 31 Jul 00:30 local
    expect(
      localCalendarDaysUntil("Europe/Ljubljana", new Date("2026-07-30T23:00:00Z"), now)
    ).toBe(0);
  });

  it("instantForLocalTime handles normal and DST-transition days", () => {
    // Normal CEST day: 08:00 local = 06:00 UTC.
    expect(
      instantForLocalTime("Europe/Ljubljana", "2026-07-20", "08:00").toISOString()
    ).toBe("2026-07-20T06:00:00.000Z");
    // EU spring-forward (2026-03-29): 02:30 local doesn't exist; the
    // resolved instant must render within the same local morning.
    const resolved = instantForLocalTime("Europe/Ljubljana", "2026-03-29", "02:30");
    expect(localDateFor("Europe/Ljubljana", resolved)).toBe("2026-03-29");
    // Fixed-offset extreme: Kiritimati (UTC+14) 09:00 local = 19:00 UTC prev day.
    expect(
      instantForLocalTime("Pacific/Kiritimati", "2026-07-20", "09:00").toISOString()
    ).toBe("2026-07-19T19:00:00.000Z");
  });
});
