/**
 * Consent configuration (Prompt 6, audit v5). Pure module — safe to import
 * from client, server and tests.
 *
 * Bump a version here when the corresponding policy materially changes;
 * existing users are then asked to re-consent at a light checkpoint before
 * their next AI generation.
 */

export const POLICY_VERSIONS = {
  /** Age self-declaration wording version. */
  age_18_plus: "2026-07",
  terms: process.env.NEXT_PUBLIC_TERMS_VERSION ?? "2026-07",
  privacy: process.env.NEXT_PUBLIC_PRIVACY_VERSION ?? "2026-07",
} as const;

export type RequiredConsentType = keyof typeof POLICY_VERSIONS;

/** Consents that must exist (at current versions) before AI generation. */
export const REQUIRED_CONSENTS: RequiredConsentType[] = [
  "age_18_plus",
  "terms",
  "privacy",
];

export interface ConsentRow {
  consent_type: string;
  version: string;
  granted: boolean;
}

/**
 * Pure evaluation of required consents from rows ordered newest-first.
 * A consent counts only when its latest row is granted at the CURRENT
 * policy version — bumping a version re-requires it.
 */
export function missingConsents(rows: ConsentRow[]): RequiredConsentType[] {
  const latest = new Map<string, ConsentRow>();
  for (const row of rows) {
    if (!latest.has(row.consent_type)) latest.set(row.consent_type, row);
  }
  return REQUIRED_CONSENTS.filter((type) => {
    const current = latest.get(type);
    return !current?.granted || current.version !== POLICY_VERSIONS[type];
  });
}
