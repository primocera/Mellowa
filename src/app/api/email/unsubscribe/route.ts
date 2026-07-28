import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isUnsubscribeCategory,
  verifyUnsubscribeToken,
  type UnsubscribeCategory,
} from "@/lib/email/unsubscribe";

/**
 * One-click unsubscribe for reminder email (MW-V10-00).
 *
 * Works signed out — an opt-out link that demands a login is not an opt-out.
 * POST implements RFC 8058 (`List-Unsubscribe-Post`), which mail clients call
 * without any user interaction; GET serves the same action for a human click.
 * Both are idempotent: unsubscribing twice is a success, not an error.
 */

function page(title: string, body: string, status = 200) {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} — Mellowa</title></head>
<body style="margin:0;background:#FAF7F2;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1F2937">
<div style="max-width:32rem;margin:0 auto;padding:3rem 1.25rem">
<div style="background:#fff;border-radius:1rem;padding:1.75rem">
<h1 style="margin:0 0 .75rem;font-size:1.25rem">${title}</h1>
<p style="margin:0 0 1.25rem;line-height:1.6;color:#6B7280">${body}</p>
<a href="/settings" style="display:inline-block;background:#6D8C7D;color:#fff;text-decoration:none;padding:.6rem 1rem;border-radius:.6rem">Reminder settings</a>
</div></div></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

async function unsubscribe(
  userId: string,
  category: UnsubscribeCategory
): Promise<boolean> {
  const admin = createAdminClient();
  // Both reminder categories are gated by the same consent switch: turning
  // reminders off pauses scheduling and clears the send time, so the planner
  // has nothing to act on regardless of which mail prompted the click.
  //
  // The reminder columns live on `wellbeing_profiles`, keyed by `user_id`.
  // This wrote to `profiles`/`id` — a table whose only columns are id, email,
  // full_name and the timestamps. So the update named columns that do not
  // exist, PostgREST rejected it, and one-click unsubscribe had never once
  // worked: the recipient got the failure page and the scheduler kept every
  // reminder exactly as it was. Clearing `reminders_opt_in` too, so the
  // consent switch the cron filters on is the thing that actually flips,
  // rather than relying on `reminder_time` being null to exclude them.
  const { error } = await admin
    .from("wellbeing_profiles")
    .update({
      reminders_opt_in: false,
      reminders_paused: true,
      reminder_time: null,
    })
    .eq("user_id", userId);
  if (error) {
    console.error("[email] unsubscribe write failed", {
      category,
      message: error.message,
    });
    return false;
  }
  return true;
}

function parse(url: URL) {
  const userId = url.searchParams.get("u") ?? "";
  const rawCategory = url.searchParams.get("c") ?? "";
  const token = url.searchParams.get("t") ?? "";
  if (!userId || !token || !isUnsubscribeCategory(rawCategory)) return null;
  if (!verifyUnsubscribeToken(userId, rawCategory, token)) return null;
  return { userId, category: rawCategory };
}

export async function GET(request: Request) {
  const parsed = parse(new URL(request.url));
  if (!parsed) {
    return page(
      "This link didn't work",
      "The unsubscribe link is invalid or has expired. You can turn reminders off any time in your reminder settings.",
      400
    );
  }
  const ok = await unsubscribe(parsed.userId, parsed.category);
  return ok
    ? page(
        "Reminders are off",
        "You won't get daily reminder emails any more. Account and billing emails still come through, because they're about your membership. You can turn reminders back on whenever you want."
      )
    : page(
        "We couldn't complete that",
        "Something went wrong turning reminders off. Please try again, or change it directly in your reminder settings.",
        500
      );
}

export async function POST(request: Request) {
  const parsed = parse(new URL(request.url));
  if (!parsed) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const ok = await unsubscribe(parsed.userId, parsed.category);
  return NextResponse.json(
    ok ? { unsubscribed: true } : { error: "failed" },
    { status: ok ? 200 : 500 }
  );
}
