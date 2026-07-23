"use client";

import { useEffect, useState } from "react";
import { Sparkles, X, Undo2 } from "lucide-react";
import { trackClient } from "@/lib/analytics/client";

type LearnedItem = { signal: string; label: string; effect: string };

/**
 * "What Mellowa uses" (Prompt 14, MW-S03): the transparent personalization
 * control center. Groups every signal a future plan can reuse — stable
 * preferences, today-only input and learned-from-feedback — with its source
 * and concrete effect, plus remove/undo for learned signals. Removal sets a
 * boundary: the signal only returns from feedback given after the removal.
 */
export function MellowaLearned() {
  const [items, setItems] = useState<LearnedItem[]>([]);
  const [carryForward, setCarryForward] = useState<string[]>([]);
  const [removed, setRemoved] = useState<LearnedItem | null>(null);
  const [loaded, setLoaded] = useState(false);
  // MW-V9-05: reset-all state — confirmation gate and the exact set the reset
  // suppressed, so "Undo reset" restores precisely those signals.
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetSignals, setResetSignals] = useState<string[] | null>(null);

  useEffect(() => {
    let active = true;
    trackClient("personalization_viewed", { surface: "settings" });
    fetch("/api/plan/feedback")
      .then((r) => (r.ok ? r.json() : { learned: [], carryForward: [] }))
      .then((d) => {
        if (!active) return;
        setItems((d.learned as LearnedItem[]) ?? []);
        setCarryForward((d.carryForward as string[]) ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  async function forget(item: LearnedItem) {
    setItems((prev) => prev.filter((i) => i.signal !== item.signal));
    setRemoved(item);
    try {
      await fetch(`/api/plan/feedback?signal=${encodeURIComponent(item.signal)}`, {
        method: "DELETE",
      });
    } catch {
      /* best effort — the item is already gone from the UI */
    }
  }

  async function undoForget() {
    if (!removed) return;
    const item = removed;
    setRemoved(null);
    setItems((prev) => [...prev, item]);
    try {
      await fetch(
        `/api/plan/feedback?signal=${encodeURIComponent(item.signal)}&restore=1`,
        { method: "DELETE" }
      );
    } catch {
      /* best effort */
    }
  }

  async function resetLearned() {
    const previous = items;
    setConfirmReset(false);
    setItems([]);
    setRemoved(null);
    try {
      const res = await fetch("/api/plan/feedback?reset=learned", { method: "DELETE" });
      const data = res.ok ? await res.json() : { reset: previous.map((i) => i.signal) };
      setResetSignals((data.reset as string[]) ?? previous.map((i) => i.signal));
    } catch {
      setResetSignals(previous.map((i) => i.signal));
    }
  }

  async function undoReset() {
    const signals = resetSignals;
    if (!signals) return;
    setResetSignals(null);
    try {
      // Restore exactly the signals this reset suppressed (conflict-safe).
      await Promise.all(
        signals.map((signal) =>
          fetch(`/api/plan/feedback?signal=${encodeURIComponent(signal)}&restore=1`, {
            method: "DELETE",
          })
        )
      );
      const r = await fetch("/api/plan/feedback");
      if (r.ok) {
        const d = await r.json();
        setItems((d.learned as LearnedItem[]) ?? []);
      }
    } catch {
      /* best effort */
    }
  }

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-[#7C9A92]" />
        <h2 className="font-medium text-[#1F2937]">What Mellowa uses</h2>
      </div>
      <p className="mt-1 text-xs text-[#6B7280]">
        Everything a future plan can reuse, with its source. Nothing else is
        remembered — free-text notes are never used as memory, and there is no
        health or personality judgment.
      </p>

      <div className="mt-3 space-y-3">
        <div className="rounded-xl bg-[#FAF7F2] px-3 py-2.5">
          <p className="text-xs font-medium uppercase tracking-wide text-[#9CA3AF]">
            Stable preferences · from your baseline and settings
          </p>
          <p className="mt-1 text-sm text-[#1F2937]">
            Food preferences, allergies, cooking time and skill, movement level
            and limitations, meal pattern and servings. Effect: every generated
            plan is built around them. Edit them in the plan preferences above.
          </p>
        </div>
        <div className="rounded-xl bg-[#FAF7F2] px-3 py-2.5">
          <p className="text-xs font-medium uppercase tracking-wide text-[#9CA3AF]">
            Today only · from each check-in
          </p>
          <p className="mt-1 text-sm text-[#1F2937]">
            Energy, stress, time, context and any note shape that single
            day&apos;s plan and are not carried into future plans as memory.
          </p>
        </div>
        <div className="rounded-xl bg-[#FAF7F2] px-3 py-2.5">
          <p className="text-xs font-medium uppercase tracking-wide text-[#9CA3AF]">
            Learned from feedback · after repeated taps, never one
          </p>
          {!loaded ? (
            <p className="mt-1 text-sm text-[#6B7280]">Loading…</p>
          ) : items.length === 0 ? (
            <p className="mt-1 text-sm text-[#6B7280]">
              Nothing yet. A signal appears only after you give the same
              feedback more than once, and you can remove it any time.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {items.map((item) => (
                <li
                  key={item.signal}
                  className="flex items-start justify-between gap-3 rounded-xl bg-white px-3 py-2.5 text-sm text-[#1F2937]"
                >
                  <span className="flex-1">
                    {item.label}
                    {item.effect && (
                      <span className="mt-0.5 block text-xs text-[#6B7280]">
                        Effect on future plans: {item.effect}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => forget(item)}
                    aria-label={`Remove: ${item.label}`}
                    className="shrink-0 rounded-full p-1 text-[#9CA3AF] transition hover:bg-[#FAF7F2] hover:text-[#991B1B]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {removed && (
            <div
              role="status"
              aria-live="polite"
              className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-[#EEF2FF] px-3 py-2 text-xs text-[#1F2937]"
            >
              <span>
                Removed — it stops affecting your next plan right away.
              </span>
              <button
                type="button"
                onClick={undoForget}
                className="flex shrink-0 items-center gap-1 font-medium text-[#7C9A92] underline underline-offset-2 hover:text-[#6D8C7D]"
              >
                <Undo2 className="h-3.5 w-3.5" />
                Undo
              </button>
            </div>
          )}

          {/* MW-V9-05: reset all learned signals at once — bounded scope,
              feedback history and profile settings kept. */}
          {loaded && items.length > 0 && !confirmReset && (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="mt-3 text-xs font-medium text-[#6B7280] underline underline-offset-2 hover:text-[#991B1B]"
            >
              Reset learned preferences
            </button>
          )}
          {confirmReset && (
            <div className="mt-3 rounded-xl border border-[#E5E1DA] bg-white px-3 py-2.5 text-xs text-[#1F2937]">
              <p>
                This removes all {items.length} learned signal
                {items.length === 1 ? "" : "s"} from future plans. Your feedback
                history and profile settings are kept, and you can undo it right
                after.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={resetLearned}
                  className="rounded-lg bg-[#7C9A92] px-3 py-1.5 font-medium text-white transition hover:bg-[#6D8C7D]"
                >
                  Reset all
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="rounded-lg border border-[#E5E1DA] px-3 py-1.5 text-[#6B7280] transition hover:border-[#7C9A92]/50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {resetSignals && (
            <div
              role="status"
              aria-live="polite"
              className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-[#EEF2FF] px-3 py-2 text-xs text-[#1F2937]"
            >
              <span>Learned preferences reset — none affect your next plan.</span>
              <button
                type="button"
                onClick={undoReset}
                className="flex shrink-0 items-center gap-1 font-medium text-[#7C9A92] underline underline-offset-2 hover:text-[#6D8C7D]"
              >
                <Undo2 className="h-3.5 w-3.5" />
                Undo reset
              </button>
            </div>
          )}
        </div>

        {/* MW-V9-05: Weekly carry-forward — the explicit choices from your
            latest weekly reflection that shape next week's plan. */}
        <div className="rounded-xl bg-[#FAF7F2] px-3 py-2.5">
          <p className="text-xs font-medium uppercase tracking-wide text-[#9CA3AF]">
            Weekly carry-forward · from your weekly reflection
          </p>
          {!loaded ? (
            <p className="mt-1 text-sm text-[#6B7280]">Loading…</p>
          ) : carryForward.length === 0 ? (
            <p className="mt-1 text-sm text-[#6B7280]">
              Nothing carried forward. When you finish a weekly reflection, the
              choices you keep for next week appear here.
            </p>
          ) : (
            <>
              <ul className="mt-2 space-y-1.5">
                {carryForward.map((effect) => (
                  <li key={effect} className="text-sm text-[#1F2937]">
                    {effect}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-[#6B7280]">
                {"Used for next week's plan. Change these in the weekly reflection."}
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
