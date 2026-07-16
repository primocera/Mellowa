"use client";

import { useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import type { Verdict } from "@/lib/feedback/learned";

/**
 * Gentle plan feedback (Prompt 14). One tap for "Helpful"; "Not for me" opens
 * a few specific, optional reasons so Mellowa can learn *why*. No scores, no
 * pressure — and free-text is never fed to the AI.
 */
export function PlanFeedback({
  planId,
  itemKey = "plan",
}: {
  planId: string;
  itemKey?: string;
}) {
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [showReasons, setShowReasons] = useState(false);

  async function send(v: Verdict) {
    setVerdict(v);
    setShowReasons(false);
    try {
      await fetch("/api/plan/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: planId, item_key: itemKey, verdict: v }),
      });
    } catch {
      /* best effort */
    }
  }

  if (verdict) {
    return (
      <p className="px-2 text-center text-xs text-[#9CA3AF]">
        {verdict === "helpful"
          ? "Thanks — noted for future plans."
          : "Thanks — we'll shape tomorrow a little differently."}
      </p>
    );
  }

  const REASONS: { v: Verdict; label: string }[] = [
    { v: "too_much", label: "Too much" },
    { v: "too_little_time", label: "Too little time" },
    { v: "didnt_fit_food", label: "Didn't fit food" },
    { v: "not_for_me", label: "Just not for me" },
  ];

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center justify-center gap-2">
        <span className="text-xs text-[#9CA3AF]">How was today&apos;s plan?</span>
        <button
          type="button"
          onClick={() => send("helpful")}
          className="flex items-center gap-1.5 rounded-full border border-[#E5E1DA] bg-white px-3 py-1.5 text-xs text-[#6B7280] transition hover:border-[#7C9A92]/50 hover:text-[#1F2937]"
        >
          <ThumbsUp className="h-3.5 w-3.5" />
          Helpful
        </button>
        <button
          type="button"
          onClick={() => setShowReasons((s) => !s)}
          aria-expanded={showReasons}
          className="flex items-center gap-1.5 rounded-full border border-[#E5E1DA] bg-white px-3 py-1.5 text-xs text-[#6B7280] transition hover:border-[#7C9A92]/50 hover:text-[#1F2937]"
        >
          <ThumbsDown className="h-3.5 w-3.5" />
          Not for me
        </button>
      </div>
      {showReasons && (
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {REASONS.map(({ v, label }) => (
            <button
              key={v}
              type="button"
              onClick={() => send(v)}
              className="rounded-full bg-[#FAF7F2] px-3 py-1.5 text-xs text-[#6B7280] transition hover:bg-[#7C9A92]/10 hover:text-[#1F2937]"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
