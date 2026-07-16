import { describe, it, expect } from "vitest";
import { PlanPreferencesInput } from "@/schemas/wellbeing";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("macros opt-in (Prompt 7)", () => {
  it("nutrition estimates default to hidden", () => {
    expect(PlanPreferencesInput.parse({}).show_macros).toBe(false);
  });

  it("explicit opt-in is preserved", () => {
    expect(PlanPreferencesInput.parse({ show_macros: true }).show_macros).toBe(true);
  });

  it("migration flips the column default and backfills", () => {
    const sql = readFileSync(
      join(__dirname, "..", "supabase", "migrations", "018_mellowa_v5_macros_optin.sql"),
      "utf8"
    );
    expect(sql).toMatch(/set default false/i);
  });

  it("no calorie budget, deficit, weight-goal or streak fields exist", () => {
    const keys = Object.keys(PlanPreferencesInput.shape).join(" ");
    expect(keys).not.toMatch(/calorie|deficit|weight|streak|target/i);
  });
});
