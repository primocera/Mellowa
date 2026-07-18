import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PROMPT_VERSIONS, type PromptKey } from "@/prompts/versions";

/**
 * Prompt immutability gate (Launch v6, Prompt 12).
 *
 * If any of these fail, a system prompt changed without a version bump.
 * Fix: in src/prompts/versions.ts bump `id` to a new version (e.g. "@2")
 * and set `sha256` to the "actual" value printed below. Never reuse an id.
 */

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("prompt version registry", () => {
  const keys = Object.keys(PROMPT_VERSIONS) as PromptKey[];

  it("covers every prompt with a unique immutable id", () => {
    const ids = keys.map((k) => PROMPT_VERSIONS[k].id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+@\d+$/);
  });

  for (const key of keys) {
    it(`hash matches recorded version for ${key}`, () => {
      const entry = PROMPT_VERSIONS[key];
      const actual = sha256(entry.systemPrompt);
      expect(
        actual,
        `Prompt "${key}" changed without a version bump. Bump id past "${entry.id}" and set sha256 to actual: ${actual}`
      ).toBe(entry.sha256);
    });
  }
});
