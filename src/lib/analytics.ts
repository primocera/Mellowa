import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Privacy-safe product events (Prompt 20). Fixed event names only — never
 * free text, never content. Fire-and-forget: analytics must never break a
 * user-facing request.
 */
export type AppEvent =
  | "checkin_completed"
  | "plan_generated"
  | "plan_fallback_served"
  | "checkout_started"
  | "subscription_started"
  | "account_deleted";

export function trackEvent(event: AppEvent, userId?: string | null): void {
  try {
    const admin = createAdminClient();
    void admin
      .from("app_events")
      .insert({ event, user_id: userId ?? null })
      .then(({ error }) => {
        if (error) console.error("[analytics] insert failed", { event });
      });
  } catch {
    /* never throw from analytics */
  }
}
