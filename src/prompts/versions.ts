import { DAILY_PLAN_SYSTEM_PROMPT } from "@/prompts/daily-plan";
import { DAILY_PLAN_V2_SYSTEM_PROMPT } from "@/prompts/daily-plan-v2";
import { HABIT_PLAN_SYSTEM_PROMPT } from "@/prompts/habits";
import { LOW_ENERGY_DAY_SYSTEM_PROMPT } from "@/prompts/low-energy-day";
import { MEAL_RHYTHM_SYSTEM_PROMPT } from "@/prompts/meal-rhythm";
import { SAFETY_SYSTEM_PROMPT } from "@/prompts/safety";
import { WEEKLY_PLAN_SYSTEM_PROMPT } from "@/prompts/weekly-plan";
import { JOURNAL_SYSTEM_PROMPT } from "@/prompts/journal";

/**
 * Immutable prompt version registry (Launch v6, Prompt 12).
 *
 * Every system prompt has a version id and a sha256 content hash. The hash is
 * enforced by tests/prompt-versions.test.ts: if a prompt's text changes, the
 * test fails until you (a) bump `id` to a NEW version string and (b) record
 * the new hash. Never edit an old id — that is what makes a version a stable
 * reference for the AI usage ledger, evals and rollback.
 *
 * Rollback = git-revert the prompt text; the hash test confirms you are back
 * on the exact previous version.
 */

export interface PromptVersion {
  /** Immutable version id, stored in ai_usage_events.prompt_version. */
  id: string;
  /** sha256 hex of the exact system prompt string. */
  sha256: string;
  systemPrompt: string;
}

export const PROMPT_VERSIONS = {
  "daily-plan": {
    id: "daily-plan@1",
    sha256: "81991e53c7b0eeef7241f9a51217a2d42c0ec72c4b7970fb1960d1785646ef3a",
    systemPrompt: DAILY_PLAN_SYSTEM_PROMPT,
  },
  "daily-plan-v2": {
    id: "daily-plan-v2@1",
    sha256: "af1206bde06fe67bcf05c6fe69ecb1c5d07ca111246cbcfe8a013197e85bb2cd",
    systemPrompt: DAILY_PLAN_V2_SYSTEM_PROMPT,
  },
  "weekly-plan": {
    id: "weekly-plan@1",
    sha256: "98cf9620e22d135b2f92d603e6a503238cf4bd6db01c01159f6fd9de65448d1a",
    systemPrompt: WEEKLY_PLAN_SYSTEM_PROMPT,
  },
  "habit-plan": {
    id: "habit-plan@1",
    sha256: "3b870641dc4f3c1c09b68f46a6183fc7e0b9e41e5030e7626f486daa1a8b98d6",
    systemPrompt: HABIT_PLAN_SYSTEM_PROMPT,
  },
  "low-energy-day": {
    id: "low-energy-day@1",
    sha256: "f15c88780fc7d51cc1e80c6a77626cd78dee5127010d7fa8c02dc060e5c9e0f2",
    systemPrompt: LOW_ENERGY_DAY_SYSTEM_PROMPT,
  },
  "meal-rhythm": {
    id: "meal-rhythm@1",
    sha256: "b0e4420c2b2aeb04e34aa31d16b8784ca5b7deb865a9d0d073d8d4780de7858d",
    systemPrompt: MEAL_RHYTHM_SYSTEM_PROMPT,
  },
  journal: {
    id: "journal@1",
    sha256: "d73c0791f0e7b43c1e425a549d9d38f7bf15eec320e2fb6b4c18f645e920a1d2",
    systemPrompt: JOURNAL_SYSTEM_PROMPT,
  },
  safety: {
    id: "safety@1",
    sha256: "b38980de090aeae76ae4b0639d112353c12f20d06bb53da2fe62ecf92f10a43c",
    systemPrompt: SAFETY_SYSTEM_PROMPT,
  },
} as const satisfies Record<string, PromptVersion>;

export type PromptKey = keyof typeof PROMPT_VERSIONS;

export function promptVersionId(key: PromptKey): string {
  return PROMPT_VERSIONS[key].id;
}
