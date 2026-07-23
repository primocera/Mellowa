"use client";

import { useEffect, useState } from "react";
import { CalendarCheck, Loader2 } from "lucide-react";
import clsx from "clsx";
import Link from "next/link";
import {
  KEEP_OPTIONS,
  LIGHTER_OPTIONS,
  CONSTRAINT_OPTIONS,
  carryForwardEffects,
  type WeeklyFact,
  type WeeklyReflectionSelections,
} from "@/lib/week/reflection";
import { trackClient } from "@/lib/analytics/client";

/**
 * MW-S06: the five-minute weekly closeout. Shows only facts derived from the
 * user's recorded inputs, asks three bounded questions and previews the exact
 * carry-forward effect before anything is saved. Nothing becomes permanent
 * silently, and sparse weeks get a preference prompt instead of invented
 * insight.
 */

const KEEP_LABELS: Record<string, string> = {
  meals: "The meals",
  calm_resets: "The calm resets",
  movement: "The movement style",
  evening_routine: "The evening wind-down",
  nothing: "Nothing in particular",
};
const LIGHTER_LABELS: Record<string, string> = {
  whole_week: "The whole week",
  mornings: "Mornings",
  evenings: "Evenings",
  meals: "Meals",
  nothing: "Nothing — it fit",
};
const CONSTRAINT_LABELS: Record<string, string> = {
  less_time: "Less time than usual",
  more_time: "A bit more time",
  away_or_travel: "Away or travelling",
  irregular_schedule: "Irregular schedule",
  same_as_usual: "Same as usual",
};

export function WeeklyReflection() {
  const [facts, setFacts] = useState<WeeklyFact[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [keep, setKeep] = useState<string[]>([]);
  const [lighter, setLighter] = useState<string | null>(null);
  const [constraint, setConstraint] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedEffects, setSavedEffects] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/week/reflection")
      .then((r) => (r.ok ? r.json() : { facts: [] }))
      .then((d) => {
        if (!active) return;
        setFacts((d.facts as WeeklyFact[]) ?? []);
        const existing = d.reflection;
        if (existing) {
          setKeep(existing.keep ?? []);
          setLighter(existing.lighter ?? null);
          setConstraint(existing.next_week_constraint ?? null);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const selections: WeeklyReflectionSelections = {
    keep: keep.filter((k) => k !== "nothing") as WeeklyReflectionSelections["keep"],
    lighter: (lighter === "nothing" ? null : lighter) as WeeklyReflectionSelections["lighter"],
    constraint: (constraint === "same_as_usual"
      ? null
      : constraint) as WeeklyReflectionSelections["constraint"],
  };
  const preview = carryForwardEffects(selections);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/week/reflection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keep, lighter, constraint }),
      });
      const data = await res.json();
      if (res.ok) {
        setSavedEffects((data.effects as string[]) ?? []);
        setOpen(false);
      } else {
        setError(data.user_message ?? "The reflection couldn't be saved — try again.");
      }
    } catch {
      setError("The reflection couldn't be saved — try again.");
    }
    setSaving(false);
  }

  if (!loaded) return null;

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <CalendarCheck className="h-4 w-4 text-[#7C9A92]" />
        <h2 className="font-medium text-[#1F2937]">Close out the week</h2>
      </div>

      {facts.length === 0 ? (
        <div className="mt-2">
          <p className="text-sm text-[#6B7280]">
            Not much was recorded this week — that&apos;s fine, there&apos;s
            nothing to catch up on. If you want next week shaped differently, the
            most direct way is to set your preferences.
          </p>
          <Link
            href="/settings"
            className="mt-3 inline-block rounded-xl border border-[#E5E1DA] px-4 py-2 text-sm text-[#1F2937] transition hover:border-[#7C9A92]/50"
          >
            Review plan preferences
          </Link>
        </div>
      ) : (
        <p className="mt-1 text-sm text-[#6B7280]">
          Pick what to reuse and what to lighten. It only shapes next week when
          you create it yourself — nothing here changes your recorded week.
        </p>
      )}

      {savedEffects && (
        <div className="mt-3 rounded-xl bg-[#DCFCE7] px-3 py-2.5 text-sm text-[#1F2937]" aria-live="polite">
          Saved. {savedEffects.length > 0
            ? "When you create next week's plan, it will apply: "
            : "Nothing carries forward — next week starts from your usual preferences."}
          {savedEffects.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-[#166534]">
              {savedEffects.map((e, i) => (
                <li key={i}>• {e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!open ? (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setSavedEffects(null);
            trackClient("weekly_reflection_started", { surface: "week" });
          }}
          className="mt-3 rounded-xl bg-[#7C9A92] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#6D8C7D]"
        >
          {savedEffects ? "Adjust what carries forward" : "Choose what carries into next week"}
        </button>
      ) : (
        <div className="mt-3 space-y-4">
          <div>
            <p className="text-sm font-medium text-[#1F2937]">What should stay?</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {KEEP_OPTIONS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() =>
                    setKeep((prev) =>
                      k === "nothing"
                        ? ["nothing"]
                        : prev.includes(k)
                          ? prev.filter((x) => x !== k)
                          : [...prev.filter((x) => x !== "nothing"), k]
                    )
                  }
                  aria-pressed={keep.includes(k)}
                  className={clsx(
                    "rounded-full border px-3 py-1.5 text-xs transition",
                    keep.includes(k)
                      ? "border-[#7C9A92] bg-[#7C9A92]/10 text-[#1F2937]"
                      : "border-[#E5E1DA] text-[#6B7280] hover:border-[#7C9A92]/50"
                  )}
                >
                  {KEEP_LABELS[k]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-[#1F2937]">What should be lighter?</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {LIGHTER_OPTIONS.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLighter(lighter === l ? null : l)}
                  aria-pressed={lighter === l}
                  className={clsx(
                    "rounded-full border px-3 py-1.5 text-xs transition",
                    lighter === l
                      ? "border-[#7C9A92] bg-[#7C9A92]/10 text-[#1F2937]"
                      : "border-[#E5E1DA] text-[#6B7280] hover:border-[#7C9A92]/50"
                  )}
                >
                  {LIGHTER_LABELS[l]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-[#1F2937]">
              What&apos;s different about next week, practically?
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {CONSTRAINT_OPTIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setConstraint(constraint === c ? null : c)}
                  aria-pressed={constraint === c}
                  className={clsx(
                    "rounded-full border px-3 py-1.5 text-xs transition",
                    constraint === c
                      ? "border-[#7C9A92] bg-[#7C9A92]/10 text-[#1F2937]"
                      : "border-[#E5E1DA] text-[#6B7280] hover:border-[#7C9A92]/50"
                  )}
                >
                  {CONSTRAINT_LABELS[c]}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl bg-[#FAF7F2] px-3 py-2.5 text-xs text-[#6B7280]">
            <p className="font-medium text-[#1F2937]">Preview — saving will apply exactly this:</p>
            {preview.length === 0 ? (
              <p className="mt-1">
                Nothing carries forward. Next week starts from your usual preferences.
              </p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {preview.map((e, i) => (
                  <li key={i}>• {e}</li>
                ))}
              </ul>
            )}
            <p className="mt-1.5">
              Applied only when you create next week&apos;s plan yourself —
              nothing is generated or changed now.
            </p>
          </div>

          {error && <p className="text-xs text-[#991B1B]">{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-[#7C9A92] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#6D8C7D] disabled:opacity-60"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save carry-forward
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={saving}
              className="rounded-xl border border-[#E5E1DA] px-4 py-2 text-sm text-[#6B7280] transition hover:border-[#7C9A92]/50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
