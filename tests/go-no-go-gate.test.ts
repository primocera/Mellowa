import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateGoNoGo, extractPaidVerdict } from "../src/lib/release/go-no-go-gate";

/**
 * MW-V9-00: the go/no-go template cannot silently flip to a paid GO verdict
 * while RC SHA, evidence or signature are still blank placeholders.
 */

describe("go/no-go gate", () => {
  it("passes an honest NO-GO document with open placeholders", () => {
    const doc = `# scorecard
RC commit = ____________
- [ ] real transaction rehearsal. Evidence: __
Public paid launch: NO-GO
Signed: ________________  Date: __________`;
    expect(extractPaidVerdict(doc)).toBe("NO-GO");
    expect(evaluateGoNoGo(doc).violations).toEqual([]);
  });

  it("passes a CONDITIONAL GO document with open placeholders", () => {
    const doc = `RC commit = ____
Public paid launch: NO-GO
Small invite-only beta: CONDITIONAL GO
Signed: ____`;
    // The paid line is the gated one; beta may stay conditional.
    expect(evaluateGoNoGo(doc).violations).toEqual([]);
  });

  it("FAILS a GO verdict that still contains blank placeholders", () => {
    const doc = `RC commit = ____________
- [ ] transaction. Evidence: __
Public paid launch: GO
Signed: ________________`;
    const result = evaluateGoNoGo(doc);
    expect(result.verdict).toBe("GO");
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("passes a GO verdict once RC SHA, evidence and signature are filled", () => {
    const doc = `RC commit = 1417579532d25136269b1329aa94c7e8d5c149e5
- [x] transaction rehearsed. Evidence: run 2026-07-30, charge/cancel/refund recorded
Public paid launch: GO
Signed: Primoz Cerar  Date: 2026-07-30`;
    const result = evaluateGoNoGo(doc);
    expect(result.verdict).toBe("GO");
    expect(result.violations).toEqual([]);
  });

  it("holds every real launch-go-no-go-*.md scorecard to the gate", () => {
    const docs = readdirSync("docs").filter((f) => /^launch-go-no-go-.*\.md$/.test(f));
    expect(docs.length).toBeGreaterThan(0);
    for (const file of docs) {
      const result = evaluateGoNoGo(readFileSync(`docs/${file}`, "utf8"));
      expect(result.violations, `${file} declares GO with blank fields`).toEqual([]);
    }
  });
});
