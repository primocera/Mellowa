"use client";

import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";

type LearnedItem = { signal: string; label: string };

/**
 * The transparent "Mellowa learned" list (Prompt 14). Shows what recent
 * feedback has taught the app in plain language, and lets the user remove any
 * item so they stay in control of what's kept.
 */
export function MellowaLearned() {
  const [items, setItems] = useState<LearnedItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/plan/feedback")
      .then((r) => (r.ok ? r.json() : { learned: [] }))
      .then((d) => {
        if (active) setItems((d.learned as LearnedItem[]) ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  async function forget(signal: string) {
    setItems((prev) => prev.filter((i) => i.signal !== signal));
    try {
      await fetch(`/api/plan/feedback?signal=${encodeURIComponent(signal)}`, {
        method: "DELETE",
      });
    } catch {
      /* best effort — the item is already gone from the UI */
    }
  }

  if (!loaded || items.length === 0) return null;

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-[#7C9A92]" />
        <h2 className="font-medium text-[#1F2937]">What Mellowa learned</h2>
      </div>
      <p className="mt-1 text-xs text-[#6B7280]">
        From your feedback — not any health or personal judgment. Remove anything
        you&apos;d rather Mellowa didn&apos;t use.
      </p>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li
            key={item.signal}
            className="flex items-start justify-between gap-3 rounded-xl bg-[#FAF7F2] px-3 py-2.5 text-sm text-[#1F2937]"
          >
            <span className="flex-1">{item.label}</span>
            <button
              type="button"
              onClick={() => forget(item.signal)}
              aria-label={`Remove: ${item.label}`}
              className="shrink-0 rounded-full p-1 text-[#9CA3AF] transition hover:bg-white hover:text-[#991B1B]"
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
