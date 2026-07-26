import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * MW-V10-06: beta intake state.
 *
 * The cap itself is enforced by a database trigger (migration `039`), because
 * signup goes through `supabase.auth.signUp` from the browser — a UI check is a
 * courtesy, not a cap. This module exists so the owner can *see* the state and
 * so the signup screen can say something honest before a user types anything.
 *
 * Closing intake never deletes data. It blocks new accounts only, so a stop
 * triggered by an unsafe-output or duplicate-charge criterion is instantly
 * reversible.
 */

export interface BetaCapacity {
  signupsOpen: boolean;
  /** null = uncapped. */
  inviteCap: number | null;
  used: number;
  /** null when uncapped. */
  remaining: number | null;
  /** True when a new account would be rejected right now. */
  full: boolean;
}

// Codes and user-facing copy live in capacity-shared.ts so the signup form (a
// client component) can recognise the gate without importing server-only code.
export {
  BETA_CLOSED_CODE,
  BETA_FULL_CODE,
  BETA_CLOSED_MESSAGE,
  isBetaGateError,
} from "@/lib/beta/capacity-shared";

export async function readBetaCapacity(
  admin: SupabaseClient
): Promise<BetaCapacity | null> {
  const { data, error } = await admin.rpc("beta_capacity");
  if (error || !data) {
    // Unknown state is reported as unknown; the caller must not invent one.
    console.warn("[beta] capacity unavailable", { message: error?.message });
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  const inviteCap = typeof row.invite_cap === "number" ? row.invite_cap : null;
  const used = typeof row.used === "number" ? row.used : 0;
  const remaining = typeof row.remaining === "number" ? row.remaining : null;
  const signupsOpen = row.signups_open !== false;

  return {
    signupsOpen,
    inviteCap,
    used,
    remaining,
    full: !signupsOpen || (inviteCap !== null && used >= inviteCap),
  };
}
