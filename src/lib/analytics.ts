import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ANALYTICS_VERSION,
  parseEvent,
  type AppEvent,
  type AnalyticsProperties,
} from "@/lib/analytics/taxonomy";

/**
 * Privacy-safe product events (Prompt 20; contract v6 Prompt 9). Server-side
 * writer. Every event is validated against the taxonomy before insert, so an
 * unknown name or a non-enumerated property can never reach the database.
 * Fire-and-forget: analytics must never break a user-facing request.
 */

export type { AppEvent, AnalyticsProperties } from "@/lib/analytics/taxonomy";

interface TrackOptions {
  userId?: string | null;
  /** Anonymous/session id for pre-signup attribution (merged on verification). */
  anonId?: string | null;
  properties?: AnalyticsProperties;
}

export function trackEvent(event: AppEvent, opts: TrackOptions = {}): void {
  try {
    // Validate name + properties; drop the event (never throw) if invalid.
    const parsed = parseEvent({ event, properties: opts.properties ?? {} });
    const admin = createAdminClient();
    void admin
      .from("app_events")
      .insert({
        event: parsed.event,
        user_id: opts.userId ?? null,
        anon_id: opts.anonId ?? null,
        event_version: ANALYTICS_VERSION,
        properties: parsed.properties,
      })
      .then(({ error }) => {
        if (error) console.error("[analytics] insert failed", { event });
      });
  } catch {
    /* never throw from analytics */
  }
}

/**
 * Merge anonymous pre-signup events onto a verified user id. Called from the
 * trusted post-verification path so acquisition attribution survives signup
 * without any cross-site identifier.
 */
export async function mergeAnonymousEvents(
  anonId: string,
  userId: string
): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.rpc("merge_anonymous_events", {
      p_anon_id: anonId,
      p_user_id: userId,
    });
  } catch {
    /* attribution merge is best-effort, never blocks verification */
  }
}
