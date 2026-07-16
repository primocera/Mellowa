import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getConsentStatus, recordRequiredConsents } from "@/lib/consent/status";

/**
 * Consent status + recording (Prompt 6, audit v5).
 * GET  → { complete, missing } against current policy versions.
 * POST → records the required consents; requires explicit confirmation flags
 *        so a stray request can never silently consent on the user's behalf.
 */

const Input = z.object({
  age_18_plus: z.literal(true),
  terms_and_privacy: z.literal(true),
});

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getConsentStatus(user.id));
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Input.safeParse(body).success) {
    return NextResponse.json({ error: "consent_flags_required" }, { status: 400 });
  }

  const ok = await recordRequiredConsents(user.id);
  if (!ok) {
    return NextResponse.json({ error: "consent_save_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
