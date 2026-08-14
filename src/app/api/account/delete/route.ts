import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFlagEnabled } from "@/lib/flags";
import { signReceipt, hashUserId } from "@/lib/account-deletion/receipt";
import { processJobById } from "@/lib/account-deletion/worker";
import type { DeletionStatus } from "@/lib/account-deletion/machine";

const Input = z.object({
  // Explicit typed confirmation so deletion can never happen by accident.
  confirm: z.literal("DELETE"),
});

const TABLE = "account_deletion_requests";

/**
 * Permanent account + data deletion (Prompt 18; hardened MW-V17-04; made
 * durable MW-V18-04).
 *
 * This route no longer performs the destructive steps inline-and-forget.
 * Instead it records ONE durable job (idempotency key `delete:<user_id>`) and
 * then drives a single best-effort pass so a normal deletion still completes
 * within the request. The state machine (src/lib/account-deletion/machine.ts) is
 * the single source of truth: every step is conditional and idempotent, and a
 * server cron re-drives any job the inline pass could not finish. Loss of the
 * auth identity mid-run can never make completion impossible — the job stores
 * the target user id itself, with no auth FK.
 *
 * Correctness invariants preserved from MW-V17-04:
 *   - Billing is verified & an owned live subscription cancelled BEFORE the auth
 *     identity is deleted, so a deleted account never orphans a billable sub.
 *   - The confirmation email and `account_deleted` event fire ONLY after the
 *     identity is verified gone and residuals are cleared — never on a partial
 *     or failed run.
 *
 * Response: an opaque request id and a short-lived signed receipt so the client
 * can poll /api/account/deletion-status after the identity (and its session)
 * are gone. The receipt carries no PII.
 */
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
  const parsed = Input.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "confirmation_required" }, { status: 400 });
  }

  // Captured in process only. The email is persisted on the job row (so the
  // worker can send the confirmation without the original session) and cleared
  // again at completion.
  const userId = user.id;
  const email = user.email ?? null;

  const admin = createAdminClient();

  // Create the durable job, or recover the existing one on a duplicate request.
  // A failed create must fail closed — we must not report a deletion we never
  // recorded, and must not fall through to any destructive work.
  const requestId = await createOrGetJob(admin, userId, email);
  if (!requestId) {
    return NextResponse.json(
      {
        error: "deletion_unavailable",
        retryable: true,
        user_message:
          "We couldn't start your deletion just now, so nothing was changed. Please try again in a moment.",
      },
      { status: 503 }
    );
  }

  // Sign the caller out immediately: the account is on its way out and the
  // session must not keep working. Deletion itself does not depend on it.
  await supabase.auth.signOut();

  // Drive one best-effort pass in-request for fast completion. Guarded by a kill
  // switch: with FLAG_ACCOUNT_DELETION_SYNC=0 the job is left entirely to the
  // cron worker. An inline failure is never surfaced as a request error — the
  // job is durable and will be retried; we only report the coarse status.
  let status: DeletionStatus = "requested";
  if (isFlagEnabled("account_deletion_sync")) {
    try {
      const res = await processJobById(requestId, admin);
      if (res) status = res.status;
    } catch (err) {
      console.error("[account/delete] inline pass failed; cron will retry", {
        message: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  const receipt = signReceipt(requestId);
  return NextResponse.json({
    ok: true,
    requestId,
    status,
    // May be null if no signing secret is configured — the client then has no
    // signed status channel and should treat deletion as in-progress.
    receipt: receipt?.token ?? null,
    receiptExpiresAt: receipt?.expiresAt ?? null,
  });
}

/**
 * Insert the job idempotently. On a duplicate (unique idempotency key) the
 * existing job id is returned so a retried POST never starts a second deletion.
 * Returns null on any unrecoverable read/write error (caller fails closed).
 */
async function createOrGetJob(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  email: string | null
): Promise<string | null> {
  const idempotencyKey = `delete:${userId}`;
  const { data, error } = await admin
    .from(TABLE)
    .insert({
      user_id: userId,
      user_id_hash: hashUserId(userId),
      idempotency_key: idempotencyKey,
      recipient_email: email,
    })
    .select("id")
    .maybeSingle();

  if (!error && data?.id) return data.id as string;

  // 23505 = unique_violation: a job for this user already exists. Return it.
  if (error?.code === "23505") {
    const { data: existing, error: readErr } = await admin
      .from(TABLE)
      .select("id")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (!readErr && existing?.id) return existing.id as string;
  }

  console.error("[account/delete] could not create deletion job");
  return null;
}
