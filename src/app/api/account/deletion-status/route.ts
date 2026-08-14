import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyReceipt } from "@/lib/account-deletion/receipt";

/**
 * Coarse status lookup for an in-flight account deletion (MW-V18-04).
 *
 * Once the auth identity is deleted, the client can no longer authenticate but
 * still needs to learn the outcome. It presents the short-lived signed receipt
 * minted at request time; this route verifies the signature and returns ONLY a
 * coarse status. No PII is read or returned, and no unauthenticated caller can
 * enumerate jobs — a valid receipt is required, and it reveals nothing beyond
 * the coarse state of one job until it expires.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("receipt") ?? "";
  const check = verifyReceipt(token);
  if (!check.ok) {
    switch (check.reason) {
      case "not_configured":
        return NextResponse.json({ error: "not_configured" }, { status: 503 });
      case "expired":
        // The receipt was valid but has aged out. By now the deletion has
        // almost certainly completed; the client should stop polling.
        return NextResponse.json({ error: "expired" }, { status: 410 });
      default:
        return NextResponse.json({ error: "invalid_receipt" }, { status: 401 });
    }
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("account_deletion_requests")
    .select("status")
    .eq("id", check.requestId)
    .maybeSingle();

  if (error) {
    // Fail closed: an unreadable job is reported as in-progress, never as done.
    return NextResponse.json({ status: "requested", done: false }, { status: 200 });
  }
  if (!data) {
    // Row is gone — it was completed and purged after retention. Nothing is left
    // to do, so this is a definite "done".
    return NextResponse.json({ status: "completed", done: true }, { status: 200 });
  }

  const status = data.status as string;
  return NextResponse.json({ status, done: status === "completed" }, { status: 200 });
}
