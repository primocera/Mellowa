import "server-only";
import type { SafetyCheckOutputType } from "@/schemas/safety";
import { crisisGuidanceFor } from "@/lib/safety/crisis-resources";

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
  const help = crisisGuidanceFor(locale);

  if (category === "eating_disorder") {
    return `Mellowa won't create restrictive eating, fasting or weight-loss guidance. If eating feels unsafe or difficult to manage, please reach out to a qualified professional or someone you trust. ${help}`;
  }
  if (category === "harm_to_others") {
    return `Mellowa can't help with this. If you or someone else may be in danger, contact local emergency services or reach out for immediate support now. ${help}`;
  }
  if (category === "medical_emergency") {
    return `Severe chest pain, fainting or trouble getting air can need urgent medical attention. Please contact your local emergency services now, or ask someone near you to help you do so.`;
  }
  if (category === "medical_nutrition") {
    return `Mellowa can't create condition-specific nutrition or treatment plans. A doctor or registered dietitian can help you make a plan that accounts for your medical needs. You can still use Mellowa for non-medical daily structure.`;
  }
  if (category === "pregnancy") {
    return `Nutrition during pregnancy, postpartum or breastfeeding needs guidance from your midwife, doctor or a registered dietitian — Mellowa isn't built for that. Non-medical daily structure remains available.`;
  }
  if (category === "substance_misuse") {
    return `Stopping a substance is something to do with proper medical support — withdrawal can be dangerous to face alone. Please talk to a doctor or local support service. ${help}`;
  }
  // self_harm / default
  return `I'm sorry this feels urgent. Mellowa can't provide crisis support. Contact local emergency services now, or reach a trusted person who can stay with you. ${help}`;
}

