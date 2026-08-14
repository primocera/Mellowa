import { describe, expect, it } from "vitest";
import {
  buildCohortScorecard,
  COHORT_DEFINITION_VERSION,
  localDate,
  type CohortEventRow,
} from "@/lib/analytics/cohort";
import {
  readExclusionRegistry,
  readCanonicalActivation,
  readCheckinDays,
} from "@/lib/analytics/facts";

/**
 * MW-V18-05: cohort activation/return come from DURABLE full-history facts, not
 * a 30-day event slice; exclusions come from a SERVER-OWNED registry; and the
 * scorecard is self-describing (definition version, source watermark, mature-
 * through). The durable readers FAIL CLOSED when their source is unavailable.
 */

const NOW = new Date("2026-08-11T12:00:00Z");
const rowOf = (rows: ReturnType<typeof buildCohortScorecard>["rows"], id: string) =>
  rows.find((r) => r.id === id)!;

describe("canonical activation is full-history, not window-bound", () => {
  it("counts a user who activated long before the event window opened", () => {
    // The event stream (a 30-day slice) contains only recent return check-ins;
    // it has NO check-in on the true activation day 60 days ago. The old
    // event-derived path would either miss activation or mis-date it.
    const events: CohortEventRow[] = ["a", "b", "c", "d", "e"].map((u) => ({
      user_id: u,
      event: "checkin_completed",
      created_at: "2026-08-02T09:00:00Z", // a D2 return, inside the window
    }));

    // Durable facts: everyone truly activated on 2026-06-12 (outside the window)
    // and checked in again on the distinct local day 2 of the cohort (06-13).
    const activatedAtByUser: Record<string, string> = {};
    const checkinLocalDaysByUser: Record<string, string[]> = {};
    for (const u of ["a", "b", "c", "d", "e"]) {
      activatedAtByUser[u] = "2026-06-12T09:00:00Z";
      checkinLocalDaysByUser[u] = ["2026-06-12", "2026-06-13"];
    }

    const sc = buildCohortScorecard({
      events,
      canonicalActivation: { activatedAtByUser, checkinLocalDaysByUser },
      now: NOW,
    });

    expect(sc.activationSource).toBe("canonical_facts");
    expect(sc.activatedUsers).toBe(5);
    const d2 = rowOf(sc.rows, "d2_return");
    // All five are long mature and all returned on distinct day 2 → 5/5.
    expect(d2.denominator).toBe(5);
    expect(d2.pending).toBe(0);
    expect(d2.numerator).toBe(5);
  });

  it("excludes registry ids from canonical activation", () => {
    const activatedAtByUser: Record<string, string> = {};
    for (const u of ["a", "b", "c", "d", "e", "staff"]) {
      activatedAtByUser[u] = "2026-06-12T09:00:00Z";
    }
    const sc = buildCohortScorecard({
      events: [],
      canonicalActivation: { activatedAtByUser, checkinLocalDaysByUser: {} },
      excludedUserIds: ["staff"],
      now: NOW,
    });
    expect(sc.activatedUsers).toBe(5); // staff removed
  });
});

describe("scorecard is self-describing (M05)", () => {
  const sc = buildCohortScorecard({
    events: ["a", "b", "c", "d", "e"].map((u) => ({
      user_id: u,
      event: "checkin_completed",
      created_at: "2026-08-01T09:00:00Z",
    })),
    sourceWatermark: "2026-08-11T00:00:00Z",
    now: NOW,
  });

  it("carries definition version and event-window provenance", () => {
    expect(sc.definitionVersion).toBe(COHORT_DEFINITION_VERSION);
    expect(sc.activationSource).toBe("event_window"); // no canonical facts supplied
    expect(sc.sourceWatermark).toBe("2026-08-11T00:00:00Z");
  });

  it("reports a conservative mature-through floor (now − 48h)", () => {
    // now is 2026-08-11T12:00Z → 48h earlier is 2026-08-09.
    expect(sc.matureThroughUtc).toBe("2026-08-09");
  });
});

// --- durable readers fail closed --------------------------------------------

type FakeResult = { data: unknown; error: unknown };
function fakeAdmin(result: FakeResult) {
  return {
    from() {
      return { select: async () => result };
    },
  } as unknown as Parameters<typeof readExclusionRegistry>[0];
}

describe("exclusion registry reader fails closed", () => {
  it("returns available=false on a read error (never a silent empty set)", async () => {
    const r = await readExclusionRegistry(fakeAdmin({ data: null, error: { message: "boom" } }));
    expect(r.available).toBe(false);
    expect(r.ids).toEqual([]);
  });

  it("returns the ids when readable", async () => {
    const r = await readExclusionRegistry(
      fakeAdmin({ data: [{ user_id: "staff" }, { user_id: null }], error: null })
    );
    expect(r.available).toBe(true);
    expect(r.ids).toEqual(["staff"]);
  });
});

describe("canonical activation reader fails closed", () => {
  it("returns available=false on error", async () => {
    const r = await readCanonicalActivation(fakeAdmin({ data: null, error: { message: "x" } }));
    expect(r.available).toBe(false);
    expect(r.activatedAtByUser).toEqual({});
  });

  it("maps rows to a user→activated_at record", async () => {
    const r = await readCanonicalActivation(
      fakeAdmin({ data: [{ user_id: "a", activated_at: "2026-06-01T00:00:00Z" }], error: null })
    );
    expect(r.available).toBe(true);
    expect(r.activatedAtByUser).toEqual({ a: "2026-06-01T00:00:00Z" });
  });
});

describe("check-in days reader buckets to the user's local day", () => {
  it("uses the user's timezone and fails closed on error", async () => {
    const err = await readCheckinDays(fakeAdmin({ data: null, error: { message: "x" } }), localDate, {});
    expect(err.available).toBe(false);

    const ok = await readCheckinDays(
      fakeAdmin({
        data: [{ user_id: "a", created_at: "2026-08-01T12:00:00Z" }],
        error: null,
      }),
      localDate,
      { a: "Pacific/Kiritimati" } // UTC+14 → already the 2nd locally
    );
    expect(ok.available).toBe(true);
    expect(ok.daysByUser.a).toEqual(["2026-08-02"]);
  });
});
