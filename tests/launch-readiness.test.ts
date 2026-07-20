import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Launch go/no-go scorecard completeness (Launch v6, Prompt 25). */

const scorecard = readFileSync("docs/launch-go-no-go-v8.md", "utf8");

describe("go/no-go scorecard", () => {
  it("records automated gates and the live steps only an operator can verify", () => {
    for (const gate of ["npm run typecheck", "vitest run", "npm run build", "release-check"]) {
      expect(scorecard.includes(gate), `scorecard missing gate: ${gate}`).toBe(true);
    }
    expect(scorecard).toMatch(/real low-value transaction/i);
    expect(scorecard).toMatch(/load test/i);
  });

  it("is honest — never claims production was verified from tests/mocks", () => {
    expect(scorecard).toMatch(/claims production behaviour[\s\S]{0,20}verified/i);
  });

  it("names an explicit invite cap", () => {
    expect(scorecard).toMatch(/25.?50|≤\s?50/);
  });

  it("lists rollback triggers including duplicate billing and unsafe output", () => {
    expect(scorecard).toMatch(/rollback trigger/i);
    expect(scorecard).toMatch(/duplicate charge|duplicate generation/i);
    expect(scorecard).toMatch(/unsafe AI output|allergen/i);
  });

  it("every remaining P1 has an owner and a deadline", () => {
    // Grab the severity table rows and check the P1 lines carry Owner+Deadline.
    const rows = scorecard.split("\n").filter((l) => /^\|\s*P[01]\s*\|/.test(l));
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const row of rows) {
      const cells = row.split("|").map((c) => c.trim());
      // | Sev | Item | Owner | Deadline | Mitigation |
      expect(cells[3], `row missing owner: ${row}`).not.toBe("");
      expect(cells[4], `row missing deadline: ${row}`).not.toBe("");
    }
  });

  it("gives a clear verdict for both paid launch and beta", () => {
    expect(scorecard).toMatch(/Public paid launch:\s*NO-GO/i);
    expect(scorecard).toMatch(/beta.*CONDITIONAL GO|CONDITIONAL GO/i);
  });
});
