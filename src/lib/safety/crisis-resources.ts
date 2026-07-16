/**
 * Versioned crisis-resource catalog (Prompt 16, audit v5). Pure module.
 *
 * Rules:
 * - Country/locale is used ONLY to select verified resources; an unknown or
 *   missing locale gets the generic fallback — never a US-specific number.
 * - Every entry records when it was last verified and by whom. Numbers must
 *   be re-verified by the legal/safety owner before paid launch and at least
 *   every 6 months.
 * - Mellowa never promises confidentiality, monitoring, response or
 *   professional support of its own.
 */

export const CRISIS_CATALOG_VERSION = "2026-07";

export interface CrisisResource {
  region: string;
  guidance: string;
  lastVerified: string; // ISO date
  owner: string;
}

export const CRISIS_RESOURCES: CrisisResource[] = [
  {
    region: "US",
    guidance:
      "In the US you can call or text 988 (Suicide & Crisis Lifeline), any time.",
    lastVerified: "2026-07-16",
    owner: "product-safety",
  },
  {
    region: "CA",
    guidance: "In Canada you can call or text 988, any time.",
    lastVerified: "2026-07-16",
    owner: "product-safety",
  },
  {
    region: "GB",
    guidance: "In the UK you can call Samaritans on 116 123, any time.",
    lastVerified: "2026-07-16",
    owner: "product-safety",
  },
  {
    region: "IE",
    guidance: "In Ireland you can call Samaritans on 116 123, any time.",
    lastVerified: "2026-07-16",
    owner: "product-safety",
  },
  {
    region: "AU",
    guidance: "In Australia you can call Lifeline on 13 11 14, any time.",
    lastVerified: "2026-07-16",
    owner: "product-safety",
  },
  {
    region: "NZ",
    guidance: "In New Zealand you can call or text 1737, any time.",
    lastVerified: "2026-07-16",
    owner: "product-safety",
  },
  {
    region: "SI",
    guidance:
      "V Sloveniji lahko kadarkoli pokličete zaupni telefon Samarijan na 116 123. V nujnih primerih pokličite 112.",
    lastVerified: "2026-07-16",
    owner: "product-safety",
  },
  {
    region: "DE",
    guidance:
      "In Germany you can call TelefonSeelsorge on 0800 111 0 111, any time. In an emergency call 112.",
    lastVerified: "2026-07-16",
    owner: "product-safety",
  },
];

/**
 * Generic fallback: distinguishes immediate danger (emergency services) from
 * ongoing distress (trusted person / local helpline) without assuming any
 * country's number.
 */
export const GENERIC_CRISIS_GUIDANCE =
  "Please contact a local crisis helpline or a trusted person now. If you're in immediate danger, call your local emergency number right away (112 works across the EU).";

/** EU member states where 112 is the verified emergency number. */
const EU_112 = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "GR", "HU",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "ES", "SE",
]);

export function crisisGuidanceFor(locale?: string | null): string {
  const region = regionFrom(locale);
  const entry = CRISIS_RESOURCES.find((r) => r.region === region);
  if (entry) return entry.guidance;
  if (region && EU_112.has(region)) {
    return `If you're in immediate danger, call 112 (the EU emergency number). For ongoing distress, please reach a local crisis helpline or a trusted person now.`;
  }
  return GENERIC_CRISIS_GUIDANCE;
}

export function regionFrom(locale?: string | null): string | null {
  if (!locale) return null;
  const parts = locale.split(/[-_]/);
  const region = parts[1]?.toUpperCase() ?? null;
  return region && /^[A-Z]{2}$/.test(region) ? region : null;
}
