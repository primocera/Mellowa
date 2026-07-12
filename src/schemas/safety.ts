import { z } from "zod";

export const riskLevels = ["none", "low", "medium", "high", "crisis"] as const;

export const riskTypes = [
  "self_harm",
  "harm_to_others",
  "eating_disorder",
  "medical_condition",
  "severe_crisis",
  "pregnancy",
  "substance_abuse",
  "other",
] as const;

export const SafetyCheckInput = z.object({
  source: z.string().min(1), // which feature the text came from (check-in, journal, ...)
  text: z.string().max(6000),
});

export type SafetyCheckInputType = z.infer<typeof SafetyCheckInput>;

export const SafetyCheckOutput = z.object({
  is_safe: z.boolean(),
  risk_level: z.enum(riskLevels),
  risk_types: z.array(z.string()),
  should_block_generation: z.boolean(),
  /** Shown to the user when generation is blocked — warm, non-clinical. */
  user_message: z.string(),
  /** Internal only — never render to the user. */
  internal_reason: z.string(),
});

export type SafetyCheckOutputType = z.infer<typeof SafetyCheckOutput>;
