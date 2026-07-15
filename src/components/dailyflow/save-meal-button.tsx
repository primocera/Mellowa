"use client";

import { useState } from "react";
import { Heart, Loader2 } from "lucide-react";
import clsx from "clsx";
import type { MealCardType } from "@/schemas/ai-output-v2";

/**
 * Save/unsave a meal to favourites (Prompt 6). Optimistic; reverts on failure.
 * `initiallySaved` lets server-rendered lists show the correct starting state.
 */
export function SaveMealButton({
  meal,
  initiallySaved = false,
}: {
  meal: MealCardType;
  initiallySaved?: boolean;
}) {
  const [saved, setSaved] = useState(initiallySaved);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !saved;
    setSaved(next);
    setBusy(true);
    try {
      const res = await fetch("/api/meals/favourite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: next ? "save" : "unsave", meal }),
      });
      if (!res.ok) throw new Error("failed");
    } catch {
      setSaved(!next);
    }
    setBusy(false);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={saved}
      aria-label={saved ? "Remove from favourites" : "Save to favourites"}
      title={saved ? "Saved" : "Save meal"}
      className="shrink-0 rounded-full p-1.5 text-[#9CA3AF] transition hover:bg-[#FAF7F2] disabled:opacity-60"
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Heart
          className={clsx(
            "h-4 w-4 transition",
            saved ? "fill-[#7C9A92] text-[#7C9A92]" : "text-[#9CA3AF]"
          )}
        />
      )}
    </button>
  );
}
