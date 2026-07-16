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
      /\b(fast(ing)?|no food) for \d+\s*days\b/i,
      /\b(500|400|300)\s*calories? a day\b/i,
    ],
  },
  {
    // Acute medical emergencies must never receive a wellness plan (or a
    // breathing exercise as the sole response) — direct to emergency care.
    category: "medical_emergency",
    level: "crisis",
    patterns: [
      /\bchest pains?\b/i,
      /\bcan'?t breathe?\b/i,
      /\b(trouble|difficulty) breathing\b/i,
      /\bheart attack\b/i,
      /\b(having|had|has) a stroke\b/i,
      /\boverdos(e|ed|ing)\b/i,
      /\bpassed out\b/i,
      /\bcoughing (up )?blood\b/i,
    ],
  },
  {
    // Disease-specific nutrition is out of scope (product rule): redirect to
    // professional care rather than generating a plan.
    category: "medical_nutrition",
    level: "high",
    patterns: [
      /\b(diabetes|diabetic|insulin)\b/i,
      /\b(kidney|renal) (disease|failure|diet)\b/i,
      /\bdialysis\b/i,
      /\b(cancer|chemo(therapy)?) (diet|nutrition|meal)/i,
      /\bcrohn'?s\b/i,
      /\bceliac disease\b/i,
      /\beating disorder recovery\b/i,
    ],
  },
  {
    category: "pregnancy",
    level: "high",
    patterns: [
      /\b(i'?m|i am|currently) pregnant\b/i,
      /\bpregnancy (diet|nutrition|meal|plan)\b/i,
      /\bbreastfeeding\b/i,
      /\bpostpartum\b/i,
      /\bgestational\b/i,
    ],
  },
  {
    category: "substance_misuse",
    level: "high",
    patterns: [
      /\b(quit|stop|withdraw(al)? from) (drinking|alcohol|opioids?|heroin|meth)\b/i,
      /\bdetox from\b/i,
      /\bwithdrawal symptoms\b/i,
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
  if (category === "medical_emergency") {
    return `This sounds like it could be a medical emergency, and Mellowa isn't able to help with that. Please contact your local emergency services right now, or ask someone near you to help you do so.`;
  }
  if (category === "medical_nutrition") {
    return `Mellowa can't create meal plans for medical conditions — that needs a doctor or registered dietitian who knows your situation. We'd love to support your general daily rhythm once you have professional guidance.`;
  }
  if (category === "pregnancy") {
    return `Nutrition during pregnancy, postpartum or breastfeeding deserves guidance from your midwife, doctor or a registered dietitian — Mellowa isn't built for that. We're still here for gentle, general daily structure whenever it helps.`;
  }
  if (category === "substance_misuse") {
    return `Coming off a substance is something to do with proper medical support — withdrawal can be dangerous to face alone. Please talk to a doctor or local support service. ${help}`;
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
