"use client";

import { useState } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import clsx from "clsx";

/**
 * Gentle plan feedback (Prompt 10). One tap — "Helpful" or "Not for me".
 * Verdicts quietly shape future plans; no scores, no pressure.
 */
export function PlanFeedback({
  planId,
  itemKey = "plan",
}: {
  planId: string;
  itemKey?: string;
}) {
  const [verdict, setVerdict] = useState<string | null>(null);

  async function send(v: "helpful" | "not_for_me") {
    setVerdict(v);
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

  return (
    <div className="flex items-center justify-center gap-2">
      <span className="text-xs text-[#9CA3AF]">How was today&apos;s plan?</span>
      {(
        [
          { v: "helpful", label: "Helpful", icon: ThumbsUp },
          { v: "not_for_me", label: "Not for me", icon: ThumbsDown },
        ] as const
      ).map(({ v, label, icon: Icon }) => (
        <button
          key={v}
          type="button"
          onClick={() => send(v)}
          className={clsx(
            "flex items-center gap-1.5 rounded-full border border-[#E5E1DA] bg-white px-3 py-1.5 text-xs text-[#6B7280] transition hover:border-[#7C9A92]/50 hover:text-[#1F2937]"
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
