import "server-only";
import { createClient } from "@/lib/supabase/server";
import { classifyBillingRead } from "@/lib/stripe/billing-state";
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
  /**
   * MW-04: true when the billing read failed, so eligibility could not be
   * verified. Surfaces must render this honestly (a "try again" state) rather
   * than promising a trial the account may not be eligible for.
   */
  unavailable: boolean;
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
      unavailable: false,
    };
  }

  const { data, error } = await supabase
    .from("subscriptions")
    .select("trial_used_at, trial_variant, trial_days")
    .eq("user_id", user.id)
    .maybeSingle();

  const billing = classifyBillingRead(data, error);
  if (billing.state === "unavailable") {
    // Never promise a trial we could not verify the account is still eligible
    // for. trialEligible=false means no trial CTA; `unavailable` lets the page
    // explain why instead of falsely claiming the trial was already used.
    return {
      trialEligible: false,
      days: null,
      chargeDate: null,
      variant: null,
      unavailable: true,
    };
  }

  const resolved = resolveTrialConfig({ userId: user.id, pinned: billing.row });
  return {
    trialEligible: !billing.row?.trial_used_at,
    days: resolved.days,
    chargeDate: chargeDateFor(resolved.days),
    variant: resolved.variant,
    unavailable: false,
  };
}
