import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  JOURNEYS,
  SEED_STATES,
  USER_STATES,
  coveredByFixture,
  requiredFixtures,
  type SeedState,
} from "../e2e/support/matrix";

/**
 * MW-V12-02: keep the canonical authenticated matrix, the seed script and the
 * spec files from drifting apart.
 *
 * The accepted-risk note the release manifest carries against P1-AUTH-E2E-AT-HEAD
 * asks for exactly this: proof that "required tests cannot silently become
 * unreachable after copy or selector changes." A browser test can pass while
 * looking at the wrong page; a required journey can vanish when a title is
 * renamed; a fixture can stop being produced when a state is removed from the
 * seed script. None of that shows up in a green suite. It shows up here, in the
 * unit run, with no browser or seeded environment required — this file only
 * reads source.
 */

const seedSrc = readFileSync("scripts/seed-test-user.mjs", "utf8");
const runnerSrc = readFileSync("scripts/run-auth-matrix.mjs", "utf8");
const specSrc: Record<string, string> = {
  "e2e/journeys.spec.ts": readFileSync("e2e/journeys.spec.ts", "utf8"),
  "e2e/daily-journey.spec.ts": readFileSync("e2e/daily-journey.spec.ts", "utf8"),
};

/** VALID_STATES the seed script actually accepts, parsed from its source. */
function seedValidStates(): string[] {
  const block = seedSrc.match(/const VALID_STATES = \[([\s\S]*?)\];/);
  expect(block, "could not find VALID_STATES in the seed script").not.toBeNull();
  return [...block![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("the seed script and the matrix agree on the fixture states", () => {
  const valid = seedValidStates();

  it("every matrix state is a state the seed script can construct", () => {
    for (const state of SEED_STATES) {
      expect(valid, `seed script cannot construct "${state}"`).toContain(state);
    }
  });

  it("the seed script constructs no state the matrix does not know about", () => {
    for (const state of valid) {
      expect(
        SEED_STATES as readonly string[],
        `seed script produces "${state}" but the matrix never lists it`,
      ).toContain(state);
    }
  });
});

describe("the matrix references only real fixtures", () => {
  it("every user state maps to a valid seed fixture", () => {
    for (const s of USER_STATES) {
      expect(SEED_STATES as readonly string[]).toContain(s.fixture);
    }
  });

  it("every journey's fixture is a valid state, 'none' or 'public'", () => {
    for (const j of JOURNEYS) {
      if (j.fixture === "none" || j.fixture === "public") continue;
      expect(SEED_STATES as readonly string[], `journey ${j.id}`).toContain(j.fixture);
    }
  });

  it("journey ids are unique", () => {
    const ids = JOURNEYS.map((j) => j.id);
    expect(new Set(ids).size, "duplicate journey id").toBe(ids.length);
  });

  it("covers all eight subscription/entitlement states the prompt names", () => {
    // trial-eligible, trial-used, trialing, active, past_due, canceled,
    // sample-used, no-subscription — each present as a distinct user state.
    for (const id of [
      "trial-eligible",
      "trial-used",
      "trialing",
      "active",
      "past_due",
      "canceled",
      "sample-used",
      "no-subscription",
    ]) {
      expect(
        USER_STATES.map((s) => s.id),
        `user state "${id}" missing from the matrix`,
      ).toContain(id);
    }
  });
});

describe("covered journeys are actually authored, and cannot be renamed away", () => {
  for (const j of JOURNEYS.filter((x) => x.coverage === "covered")) {
    it(`"${j.id}" has a test whose title matches the matrix`, () => {
      expect(j.titleNeedle, `covered journey ${j.id} has no titleNeedle`).toBeTruthy();
      const src = specSrc[j.spec];
      expect(src, `unknown spec ${j.spec} for ${j.id}`).toBeTruthy();
      // If someone renames the test, this fails — forcing the matrix and the
      // spec back into agreement rather than silently orphaning the coverage.
      expect(
        src,
        `no test titled like "${j.titleNeedle}" in ${j.spec} — the journey ` +
          `"${j.id}" is claimed as covered but the test was renamed or removed`,
      ).toContain(j.titleNeedle!);
    });
  }
});

describe("every fixture-driven skip names a real state", () => {
  // A skip guard with a typo'd or removed state is unfalsifiable: it skips
  // forever and reads as a deliberate decision. Every SEEDED_STATE !== "X" and
  // needsState("X") in the specs must reference a state the matrix knows.
  for (const [spec, src] of Object.entries(specSrc)) {
    it(`${spec} skips only on known states`, () => {
      const referenced = [
        ...src.matchAll(/SEEDED_STATE\s*!==\s*"([^"]+)"/g),
        ...src.matchAll(/needsState\("([^"]+)"\)/g),
        ...src.matchAll(/seed\("([^"]+)"\)/g),
      ].map((m) => m[1]);
      for (const state of referenced) {
        expect(SEED_STATES as readonly string[], `${spec} references "${state}"`).toContain(
          state as SeedState,
        );
      }
    });
  }
});

describe("the release runner is wired to the matrix and RC gate", () => {
  it("imports the canonical matrix rather than re-listing states", () => {
    expect(runnerSrc).toMatch(/support\/matrix/);
  });

  it("has an RC mode that fails closed", () => {
    expect(runnerSrc).toMatch(/RC_GATE|--rc/);
    // It must be able to exit non-zero — a runner that can only pass is not a gate.
    expect(runnerSrc).toMatch(/process\.exit\(1\)/);
  });

  it("every covered fixture is something the runner will seed", () => {
    // requiredFixtures drives the run; coveredByFixture drives assertions.
    const required = new Set(requiredFixtures());
    for (const fixture of coveredByFixture().keys()) {
      expect(required, `covered fixture ${fixture} is not in requiredFixtures`).toContain(
        fixture,
      );
    }
  });
});
