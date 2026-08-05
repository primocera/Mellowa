import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOG } from "@/lib/stripe/plans";

/**
 * MW-01: an owner following a CURRENT operational document must never validate,
 * charge or promote a retired price. The product is USD-first
 * ($12.99 / $129.99) with EU/EEA EUR currency_options (€11.99 / €119.99); the
 * retired model was EUR-only €9.99 / €59.99 with a "Save 50%"/"~€5/mo" story.
 *
 * This scans an allowlist of ACTIVE operational docs. Historical release records
 * (docs/release/v11..v13, launch-go-no-go-v8..v11, handoff-v9, …) intentionally
 * preserve what was charged at the time and are NOT scanned — they are evidence,
 * not instructions. A retired literal is tolerated in an active doc only on a
 * line explicitly labelled historical.
 */

// Current prices come from the ONE catalog, so this test moves with plans.ts.
const CURRENT = [
  CATALOG.usd.monthly.display,
  CATALOG.usd.yearly.display,
  CATALOG.eur.monthly.display,
  CATALOG.eur.yearly.display,
];

// Retired current-price claims + banned marketing math.
const RETIRED: RegExp[] = [
  /€9\.99/,
  /€59\.99/,
  /Save 50%/i,
  /About €5\b/i,
  /€5\/mo/i,
  /€5\/month/i,
];

const ACTIVE_DOCS = [
  "docs/runbooks/live-transaction-rehearsal.md",
  "docs/runbooks/monitoring-alerts.md",
  "docs/deployment-checklist.md",
  "docs/beta-scorecard.md",
  "docs/experiments/trial-length.md",
];

// A line carrying one of these markers is explicitly historical/labelled and may
// quote a retired price as evidence of what was once charged.
const HISTORICAL_LINE = /\b(historical|superseded|previously|was charged|\(v1[123]\b)/i;

describe("active operational docs use only current catalog pricing (MW-01)", () => {
  it("catalog sanity: the current catalog is not the retired one", () => {
    expect(CURRENT).toContain("$12.99");
    expect(CURRENT).not.toContain("€9.99");
    expect(CURRENT).not.toContain("€59.99");
  });

  for (const path of ACTIVE_DOCS) {
    it(`${path} contains no unlabelled retired price`, () => {
      const offenders: string[] = [];
      readFileSync(path, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (HISTORICAL_LINE.test(line)) return; // labelled historical: allowed
          if (RETIRED.some((re) => re.test(line))) {
            offenders.push(`${path}:${i + 1}  ${line.trim()}`);
          }
        });
      expect(
        offenders,
        `retired price in an active operational doc:\n${offenders.join("\n")}`
      ).toEqual([]);
    });
  }
});
