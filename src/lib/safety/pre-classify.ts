import "server-only";
import type { SafetyCheckOutputType } from "@/schemas/safety";

/**
 * Deterministic safety pre-classifier (Prompt 17).
 *
 * Before spending a provider call on the AI safety classifier, scan the text
 * for unambiguous, high-signal crisis language. Clear matches are blocked
 * immediately — this is faster, free, and (crucially) still works if the AI
 * provider is down, so the most serious cases never depend on model uptime.
 *
 * This is a PRE-filter, not a replacement: anything it does not catch still
 * goes to the AI classifier. Patterns are intentionally specific (mostly
 * multi-word) to avoid false positives on ordinary phrases like "dying to
 * sleep" or "this is killing me".
 */

interface PrePattern {
  category: string;
  level: "high" | "crisis";
  patterns: RegExp[];
}

const RULES: PrePattern[] = [
  {
    category: "self_harm",
    level: "crisis",
    patterns: [
      /\bkill(ing)? myself\b/i,
      /\bsuicid(e|al)\b/i,
      /\bend(ing)? my life\b/i,
      /\b(want|going) to die\b/i,
      /\bdon'?t want to (be alive|live)\b/i,
      /\bno reason to live\b/i,
      /\bself[-\s]?harm\b/i,
      /\b(cut|hurt|harm)(ting)? myself\b/i,
      /\bcutting myself\b/i,
    ],
  },
  {
    category: "harm_to_others",
    level: "crisis",
    patterns: [
      /\bkill (him|her|them|someone|people)\b/i,
      /\b(want|going) to hurt (someone|somebody|him|her|them)\b/i,
    ],
  },
  {
    category: "eating_disorder",
    level: "high",
    patterns: [
      /\bpurg(e|ing)\b/i,
      /\bmake myself (throw up|vomit|sick)\b/i,
      /\b(throw up|vomit) after eating\b/i,
      /\blaxatives?\b.*\b(lose|weight|purge)\b/i,
      /\banorexi/i,
      /\bbulimi/i,
      /\bstarv(e|ing) myself\b/i,
      /\bnot eat(ing)? for (days|a week)\b/i,
    ],
  },
];

/**
 * Returns a blocking safety result if the text clearly matches a crisis
 * pattern, or null to defer to the AI classifier.
 */
export function preClassifySafety(
  text: string,
  locale?: string | null
): SafetyCheckOutputType | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  for (const rule of RULES) {
    if (rule.patterns.some((re) => re.test(trimmed))) {
      return {
        is_safe: false,
        risk_level: rule.level,
        risk_types: [rule.category],
        should_block_generation: true,
        user_message: crisisMessage(rule.category, locale),
        internal_reason: `deterministic pre-classifier matched ${rule.category}`,
      };
    }
  }

  return null;
}

/**
 * Region-appropriate crisis guidance. Warm, non-clinical, never shaming.
 * Locale is a BCP-47 tag (e.g. "en-US"); we key off the region subtag.
 */
export function crisisMessage(category: string, locale?: string | null): string {
  const region = regionFrom(locale);
  const help = HELPLINES[region] ?? HELPLINES.DEFAULT;

  if (category === "eating_disorder") {
    return `It sounds like you may be going through something really hard around food and eating. Mellowa isn't the right tool for this, and you deserve real support. ${help} You don't have to face this alone.`;
  }
  if (category === "harm_to_others") {
    return `This isn't something Mellowa can help with. If you or someone else may be in danger, please reach out for immediate support. ${help}`;
  }
  // self_harm / default
  return `I'm really sorry you're feeling this way. Mellowa can't help with this, but please reach out to someone who can — you matter. ${help}`;
}

// Region subtag -> a short, safe pointer to local support.
const HELPLINES: Record<string, string> = {
  US: "In the US you can call or text 988 (Suicide & Crisis Lifeline), any time.",
  CA: "In Canada you can call or text 988, any time.",
  GB: "In the UK you can call Samaritans on 116 123, any time.",
  IE: "In Ireland you can call Samaritans on 116 123, any time.",
  AU: "In Australia you can call Lifeline on 13 11 14, any time.",
  NZ: "In New Zealand you can call or text 1737, any time.",
  DEFAULT:
    "Please contact a local crisis helpline or your local emergency services — if you're in immediate danger, call your emergency number now.",
};

function regionFrom(locale?: string | null): string {
  if (!locale) return "DEFAULT";
  const parts = locale.split(/[-_]/);
  const region = parts[1]?.toUpperCase();
  return region && HELPLINES[region] ? region : "DEFAULT";
}
