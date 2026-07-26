import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  chargeDateFor,
  publicTrialDays,
  resolveTrialConfig,
  type TrialVariant,
} from "@/lib/stripe/trial-experiment";

/**
 * MW-V10-02: one server-side answer to "what trial does this viewer get?",
 * shared by pricing, billing, the landing offer and the legal pages, so every
 * surface discloses the same length and the same charge date.
 *
 * A signed-in viewer always gets an exact number: their assignment is
 * deterministic and, once they have started checkout, pinned. An anonymous
 * viewer gets the control length while no experiment is running (so default
 * production copy is unchanged) and `null` once a cohort is being assigned —
 * because at that point the length honestly is not known until the user is.
 */
export interface TrialDisclosure {
  /** False when this account has already consumed its one lifetime trial. */
  trialEligible: boolean;
  /** Trial length in days, or null when not knowable for this viewer. */
  days: number | null;
  /** Charge date (YYYY-MM-DD) if a trial started today, or null with `days`. */
  chargeDate: string | null;
  /** Assigned cohort code, for server-side instrumentation only. */
  variant: TrialVariant | null;
}

export async function trialDisclosureForViewer(): Promise<TrialDisclosure> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const days = publicTrialDays();
    return {
      trialEligible: true,
      days,
      chargeDate: days === null ? null : chargeDateFor(days),
      variant: null,
    };
  }

  const { data } = await supabase
    .from("subscriptions")
    .select("trial_used_at, trial_variant, trial_days")
    .eq("user_id", user.id)
    .maybeSingle();

  const resolved = resolveTrialConfig({ userId: user.id, pinned: data });
  return {
    trialEligible: !data?.trial_used_at,
    days: resolved.days,
    chargeDate: chargeDateFor(resolved.days),
    variant: resolved.variant,
  };
}
