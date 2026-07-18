import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { trackEvent } from "@/lib/analytics";
import {
  CLIENT_EVENTS,
  parseEvent,
  type AppEvent,
} from "@/lib/analytics/taxonomy";

/**
 * Client event ingest (Launch v6, Prompt 9). Browsers may record VIEWS and
 * CLICKS only — never identity, billing or generation truth. Server-authoritative
 * events are rejected here; they are emitted from trusted server paths. The
 * payload is validated against the analytics contract, so no unknown name and
 * no non-enumerated (potentially sensitive) property can be stored.
 */

const Input = z.object({
  event: z.string(),
  properties: z.record(z.string(), z.unknown()).optional(),
  // Client-generated anonymous id for pre-signup attribution. Opaque slug.
  anon_id: z
    .string()
    .regex(/^[a-z0-9-]{8,64}$/)
    .optional(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const outer = Input.safeParse(body);
  if (!outer.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // Validate against the full contract (name + enumerated properties).
  let parsed;
  try {
    parsed = parseEvent({
      event: outer.data.event,
      properties: outer.data.properties ?? {},
    });
  } catch {
    return NextResponse.json({ error: "Unknown event or property" }, { status: 400 });
  }

  // A browser can never assert a server-authoritative fact.
  if (!CLIENT_EVENTS.has(parsed.event as AppEvent)) {
    return NextResponse.json(
      { error: "This event is recorded server-side only" },
      { status: 403 }
    );
  }

  // Attribute to the signed-in user if present, else to the anonymous id.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  trackEvent(parsed.event, {
    userId: user?.id ?? null,
    anonId: user ? null : outer.data.anon_id ?? null,
    properties: parsed.properties,
  });

  return NextResponse.json({ ok: true });
}
