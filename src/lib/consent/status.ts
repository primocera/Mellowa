import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  POLICY_VERSIONS,
  REQUIRED_CONSENTS,
  missingConsents,
  type RequiredConsentType,
} from "./config";

export interface ConsentStatus {
  complete: boolean;
  /** Required consents missing or recorded against an outdated version. */
  missing: RequiredConsentType[];
}

/**
 * Checks whether the user has granted every required consent at the current
 * policy versions (Prompt 6). Reads through RLS as the user themself.
 */
export async function getConsentStatus(userId: string): Promise<ConsentStatus> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_consents")
    .select("consent_type, version, granted, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  const missing = missingConsents(data ?? []);
  return { complete: missing.length === 0, missing };
}

/** Records the required consents at current versions for the caller. */
export async function recordRequiredConsents(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const rows = REQUIRED_CONSENTS.map((type) => ({
    user_id: userId,
    consent_type: type,
    version: POLICY_VERSIONS[type],
    granted: true,
  }));
  const { error } = await supabase.from("user_consents").insert(rows);
  return !error;
}
