import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { USER_DATA_REGISTRY } from "@/lib/privacy/registry";

/**
 * MW-S04: routine presets — practical prefill only, transparent and
 * reversible, with the custom name kept out of AI prompts and analytics.
 */

const migration = readFileSync(
  "supabase/migrations/029_mellowa_v8_routine_presets.sql",
  "utf8"
);
const api = readFileSync("src/app/api/presets/route.ts", "utf8");
const form = readFileSync("src/components/dailyflow/checkin-form.tsx", "utf8");

describe("presets schema", () => {
  it("is RLS-protected with bounded values and a unique user/name", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("unique (user_id, name)");
    expect(migration).toMatch(/char_length\(name\) between 1 and 40/);
    expect(migration).toMatch(/context in \(/);
    expect(migration).toMatch(/mode in \(/);
    expect(migration).toMatch(/weekday_default between 0 and 6/);
  });

  it("stores no sensitive fields — no energy/stress/notes/health columns", () => {
    const sqlOnly = migration
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(sqlOnly).not.toMatch(/energy|stress|mood|note|health|diagnos/i);
  });

  it("is registered for privacy export/delete", () => {
    expect(
      USER_DATA_REGISTRY.some(
        (t) => t.table === "routine_presets" && t.onDelete === "cascade"
      )
    ).toBe(true);
  });
});

describe("presets API", () => {
  it("caps the preset count and validates with bounded enums", () => {
    expect(api).toContain("MAX_PRESETS");
    expect(api).toMatch(/z\s*\.enum\(\["busy"/);
  });

  it("never sends the custom name to analytics", () => {
    // Events carry categorical context only; grab every trackEvent call and
    // assert none references the name.
    const calls = api.match(/trackEvent\([\s\S]*?\);/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call).not.toMatch(/name/);
    }
  });
});

describe("preset application in check-in", () => {
  it("prefills only practical fields — never energy, stress or notes", () => {
    const applyFn = form.slice(
      form.indexOf("function applyPreset"),
      form.indexOf("function removeApplied")
    );
    expect(applyFn).toMatch(/next\.time/);
    expect(applyFn).toMatch(/next\.context/);
    expect(applyFn).not.toMatch(/next\.energy|next\.stress|next\.notes|next\.mood/);
  });

  it("shows a visible applied chip listing filled fields with one-tap remove", () => {
    expect(form).toContain("Applied preset");
    expect(form).toContain("Remove for today");
    expect(form).toMatch(/Energy and stress below are always about today/);
  });

  it("saving states what is and is not stored", () => {
    expect(form).toContain("Save current setup as preset");
    expect(form).toMatch(/never today('|&apos;)s energy,?\s*(<[^>]+>)?\s*stress or notes/i);
  });

  it("weekday default is user-configured, never inferred", () => {
    expect(form).toContain("Use automatically on");
    expect(form).toContain("No day — apply manually");
  });

  it("the preset name is never included in the plan generation payload", () => {
    // The daily-plan submit payload builds from draft fields only.
    const submitFn = form.slice(
      form.indexOf('async function submit('),
      form.indexOf("if (safetyMessage)")
    );
    expect(submitFn).not.toMatch(/preset/i);
  });
});
