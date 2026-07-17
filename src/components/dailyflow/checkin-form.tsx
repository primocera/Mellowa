"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, Feather } from "lucide-react";
import clsx from "clsx";

function Scale({
  label,
  low,
  high,
  value,
  onChange,
}: {
  label: string;
  low: string;
  high: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-[#1F2937]">{label}</p>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={clsx(
              "h-11 flex-1 rounded-xl border text-sm font-medium transition",
              value === n
                ? "border-[#7C9A92] bg-[#7C9A92] text-white"
                : "border-[#E5E1DA] bg-white text-[#6B7280] hover:border-[#7C9A92]/50"
            )}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-[#9CA3AF]">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}

const TIME_OPTIONS = [
  "Very little today",
  "About 30 minutes",
  "1–2 hours",
  "A fairly open day",
];

const CONTEXT_OPTIONS: { value: string; label: string }[] = [
  { value: "office", label: "Office day" },
  { value: "home", label: "At home" },
  { value: "caregiving", label: "Caregiving" },
  { value: "shift", label: "Shift work" },
  { value: "travel", label: "Travelling" },
  { value: "irregular", label: "Irregular day" },
];

const MODE_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: "auto", label: "Choose for me", hint: "Based on your check-in" },
  { value: "minimum", label: "Minimum day", hint: "Just the essentials" },
  { value: "balanced", label: "Balanced day", hint: "A full gentle rhythm" },
  { value: "reset", label: "Reset day", hint: "Calm and fewer commitments" },
  { value: "custom", label: "Custom", hint: "Pick your own areas" },
];

const AREA_OPTIONS: { value: string; label: string }[] = [
  { value: "food", label: "Food" },
  { value: "energy", label: "Energy" },
  { value: "calm", label: "Calm" },
  { value: "movement", label: "Movement" },
  { value: "sleep", label: "Sleep" },
];

const DRAFT_KEY = "mellowa_checkin_draft";

type Draft = {
  energy: number;
  stress: number;
  mood: number;
  sleep: number;
  time: string;
  context: string;
  mode: string;
  areas: string[];
  hunger: string;
  focus: string;
  notes: string;
};

const DEFAULT_DRAFT: Draft = {
  energy: 3,
  stress: 3,
  mood: 3,
  sleep: 3,
  time: "",
  context: "",
  mode: "auto",
  areas: [],
  hunger: "",
  focus: "",
  notes: "",
};

function localDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function CheckinForm() {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT);
  const [showDetail, setShowDetail] = useState(false);
  const [loading, setLoading] = useState<"plan" | "skip" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [safetyMessage, setSafetyMessage] = useState<string | null>(null);
  const restored = useRef(false);
  // Stable per submission attempt: double clicks and retries of the same
  // submit reuse one key so the server generates at most once (v6 Prompt 7).
  const idemKey = useRef<string | null>(null);

  // Restore + autosave draft (today only), so an interruption loses nothing.
  // localStorage is unavailable during SSR, so the restore must happen in a
  // mount effect rather than the initializer.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved?.date === localDate() && saved.draft) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setDraft({ ...DEFAULT_DRAFT, ...saved.draft });
        }
      }
    } catch {
      /* corrupted draft — start fresh */
    }
    restored.current = true;
  }, []);
  useEffect(() => {
    if (!restored.current) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ date: localDate(), draft }));
    } catch {
      /* storage full/blocked — draft is a convenience only */
    }
  }, [draft]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  async function submit(kind: "plan" | "skip") {
    setError(null);
    setSafetyMessage(null);
    setLoading(kind);
    if (!idemKey.current) idemKey.current = crypto.randomUUID();

    const payload =
      kind === "skip"
        ? {
            // Skip: no questions, just a Minimum Day from neutral values.
            energy_level: 2,
            stress_level: 3,
            mode: "minimum",
            custom_areas: [],
          }
        : {
            energy_level: draft.energy,
            mood_level: draft.mood,
            stress_level: draft.stress,
            sleep_quality: draft.sleep,
            hunger_pattern: draft.hunger,
            time_available: draft.time,
            today_focus: draft.focus,
            notes: draft.notes,
            context: draft.context,
            mode: draft.mode,
            custom_areas: draft.mode === "custom" ? draft.areas : [],
          };

    try {
      const res = await fetch("/api/ai/daily-plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Idempotency-Key": idemKey.current,
        },
        body: JSON.stringify({
          ...payload,
          local_date: localDate(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 402) {
          setError(
            "You've used your free sample plan. Start 3 days free on the Billing page to keep creating daily plans."
          );
        } else {
          setError(
            data.error === "onboarding_required"
              ? "Please finish onboarding first."
              : "Something went wrong. Please try again."
          );
        }
        setLoading(null);
        return;
      }

      if (data.blocked) {
        setSafetyMessage(data.user_message);
        setLoading(null);
        return;
      }

      idemKey.current = null;
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      router.push("/today");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(null);
    }
  }

  if (safetyMessage) {
    return (
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <div className="rounded-xl bg-[#EEF2FF] px-4 py-4 text-sm leading-relaxed text-[#1F2937]">
          {safetyMessage}
        </div>
        <button
          onClick={() => setSafetyMessage(null)}
          className="mt-4 rounded-xl border border-[#E5E1DA] px-4 py-2.5 text-sm text-[#6B7280] transition hover:text-[#1F2937]"
        >
          Back to check-in
        </button>
      </div>
    );
  }

  const inputClass =
    "w-full rounded-xl border border-[#E5E1DA] px-4 py-3 text-[#1F2937] placeholder:text-[#9CA3AF] focus:border-[#7C9A92] focus:outline-none";

  return (
    <div className="space-y-5 rounded-2xl bg-white p-6 shadow-sm sm:p-8">
      <Scale label="Energy today" low="Running on empty" high="Feeling great" value={draft.energy} onChange={(v) => set("energy", v)} />
      <Scale label="Stress" low="Calm" high="Very stressed" value={draft.stress} onChange={(v) => set("stress", v)} />

      <div>
        <p className="mb-2 text-sm font-medium text-[#1F2937]">Time for yourself today</p>
        <div className="grid grid-cols-2 gap-2">
          {TIME_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => set("time", draft.time === opt ? "" : opt)}
              className={clsx(
                "rounded-xl border px-3 py-2.5 text-sm transition",
                draft.time === opt
                  ? "border-[#7C9A92] bg-[#7C9A92]/10 font-medium text-[#1F2937]"
                  : "border-[#E5E1DA] bg-white text-[#6B7280] hover:border-[#7C9A92]/50"
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-[#1F2937]">
          What does today look like? <span className="font-normal text-[#6B7280]">(optional)</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {CONTEXT_OPTIONS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => set("context", draft.context === c.value ? "" : c.value)}
              className={clsx(
                "rounded-full border px-3.5 py-1.5 text-sm transition",
                draft.context === c.value
                  ? "border-[#7C9A92] bg-[#7C9A92] text-white"
                  : "border-[#E5E1DA] bg-white text-[#6B7280] hover:border-[#7C9A92]/50"
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-[#1F2937]">
          What kind of support would help today?
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {MODE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => set("mode", opt.value)}
              className={clsx(
                "rounded-xl border px-3 py-2.5 text-left transition",
                draft.mode === opt.value
                  ? "border-[#7C9A92] bg-[#7C9A92]/10"
                  : "border-[#E5E1DA] bg-white hover:border-[#7C9A92]/50"
              )}
            >
              <span className="block text-sm font-medium text-[#1F2937]">{opt.label}</span>
              <span className="block text-xs text-[#9CA3AF]">{opt.hint}</span>
            </button>
          ))}
        </div>
        {draft.mode === "custom" && (
          <div className="mt-3">
            <p className="mb-2 text-xs text-[#6B7280]">
              Your plan will only include what you pick:
            </p>
            <div className="flex flex-wrap gap-2">
              {AREA_OPTIONS.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  onClick={() =>
                    set(
                      "areas",
                      draft.areas.includes(a.value)
                        ? draft.areas.filter((x) => x !== a.value)
                        : [...draft.areas, a.value]
                    )
                  }
                  className={clsx(
                    "rounded-full border px-3.5 py-1.5 text-sm transition",
                    draft.areas.includes(a.value)
                      ? "border-[#7C9A92] bg-[#7C9A92] text-white"
                      : "border-[#E5E1DA] bg-white text-[#6B7280] hover:border-[#7C9A92]/50"
                  )}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Optional detail, collapsed by default */}
      <button
        type="button"
        onClick={() => setShowDetail((s) => !s)}
        className="flex items-center gap-1 text-sm font-medium text-[#7C9A92]"
      >
        <ChevronDown className={clsx("h-4 w-4 transition", showDetail && "rotate-180")} />
        Add detail (mood, sleep, notes)
      </button>

      {showDetail && (
        <div className="space-y-5 rounded-xl bg-[#FAF7F2] p-4">
          <Scale label="Mood" low="Low" high="Bright" value={draft.mood} onChange={(v) => set("mood", v)} />
          <Scale label="Last night's sleep" low="Rough" high="Restful" value={draft.sleep} onChange={(v) => set("sleep", v)} />
          <div>
            <label className="mb-1 block text-sm font-medium text-[#1F2937]">
              How&apos;s your appetite today?
            </label>
            <input
              type="text"
              value={draft.hunger}
              onChange={(e) => set("hunger", e.target.value)}
              placeholder="e.g. barely hungry in the morning, snacky at night"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-[#1F2937]">
              One thing you&apos;d like to focus on
            </label>
            <input
              type="text"
              value={draft.focus}
              onChange={(e) => set("focus", e.target.value)}
              placeholder="e.g. eat a real lunch, short walk, earlier bedtime"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-[#1F2937]">
              Anything else on your mind?
            </label>
            <textarea
              value={draft.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={3}
              placeholder="Totally optional — whatever helps your plan fit today."
              className={inputClass}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-[#FEE2E2] px-4 py-3 text-sm text-[#991B1B]">{error}</div>
      )}

      <button
        onClick={() => submit("plan")}
        disabled={loading !== null}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#7C9A92] px-4 py-3.5 font-medium text-white transition hover:bg-[#6D8C7D] disabled:opacity-70"
      >
        {loading === "plan" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Building a realistic plan for today...
          </>
        ) : (
          "Create today's plan"
        )}
      </button>

      <button
        onClick={() => submit("skip")}
        disabled={loading !== null}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#E5E1DA] bg-white px-4 py-3 text-sm text-[#6B7280] transition hover:border-[#7C9A92]/50 hover:text-[#1F2937] disabled:opacity-60"
      >
        {loading === "skip" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Preparing a gentle minimum day...
          </>
        ) : (
          <>
            <Feather className="h-4 w-4" />
            Skip check-in — just give me a Minimum Day
          </>
        )}
      </button>
    </div>
  );
}
