"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { serializeIntent, type PlanIntent } from "@/lib/auth/intent";

const RESEND_COOLDOWN_S = 60;

export function VerifyEmailCard({
  email,
  plan,
  next,
  linkExpired,
}: {
  email: string | null;
  plan: PlanIntent | null;
  next: string | null;
  linkExpired: boolean;
}) {
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function resend() {
    if (!email || sending || cooldown > 0) return;
    setSending(true);
    setStatus(null);
    setNotice(null);
    // Server route (/api/auth/resend-verification): rate-limited per address
    // and non-enumerating; it carries the same ?plan/?next intent to the link.
    let res: Response | null = null;
    try {
      res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, plan, next }),
      });
    } catch {
      res = null;
    }
    if (res && (res.status === 429 || res.status === 503)) {
      const body = (await res.json().catch(() => null)) as { user_message?: string } | null;
      const retryAfter = Number(res.headers.get("Retry-After"));
      setNotice(body?.user_message ?? "Please wait a little and try again.");
      // Honour the server's wait (capped so the button never looks stuck).
      setCooldown(
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(Math.ceil(retryAfter), 15 * 60)
          : RESEND_COOLDOWN_S
      );
      setSending(false);
      return;
    }
    if (!res) {
      setNotice("That didn't go through. Please check your connection and try again.");
      setSending(false);
      return;
    }
    // Non-enumerating: the same message regardless of account state.
    setStatus("A new confirmation link is on its way. You can request another in 60 seconds.");
    setCooldown(RESEND_COOLDOWN_S);
    setSending(false);
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-[#1F2937]">
        Check your email to continue
      </h2>

      {linkExpired && (
        <div className="rounded-xl bg-[#FEE2E2] px-4 py-3 text-sm text-[#991B1B]">
          That confirmation link is no longer valid. Request a new one below.
        </div>
      )}

      <p className="text-sm text-[#1F2937]">
        {email ? (
          <>
            We sent a confirmation link to <strong>{email}</strong>. Open it to
            finish setting up Mellowa. The link may take a minute to arrive.
          </>
        ) : (
          <>
            We sent a confirmation link to your email address. Open it to finish
            setting up Mellowa. The link may take a minute to arrive.
          </>
        )}
      </p>

      <p className="text-sm text-[#6B7280]">
        Didn&rsquo;t receive it? Check your spam or promotions folder
        {email ? " or resend the link" : ""}.
      </p>

      {status && (
        <div aria-live="polite" className="rounded-xl bg-[#DCFCE7] px-4 py-3 text-sm text-[#166534]">
          {status}
        </div>
      )}

      {notice && (
        <div role="alert" className="rounded-xl bg-[#FEE2E2] px-4 py-3 text-sm text-[#991B1B]">
          {notice}
        </div>
      )}

      {email && (
        <button
          type="button"
          onClick={resend}
          disabled={sending || cooldown > 0}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#7C9A92] px-4 py-3 font-medium text-white transition hover:bg-[#6D8C7D] disabled:opacity-60"
        >
          {sending && <Loader2 className="h-4 w-4 animate-spin" />}
          {cooldown > 0 ? `Resend available in ${cooldown}s` : "Resend email"}
        </button>
      )}

      <p className="text-center text-sm text-[#6B7280]">
        Wrong address?{" "}
        <Link
          href={`/signup${serializeIntent({ plan, next })}`}
          className="font-medium text-[#7C9A92] hover:underline"
        >
          Use a different email
        </Link>
      </p>
    </div>
  );
}
