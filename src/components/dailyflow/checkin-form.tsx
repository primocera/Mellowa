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
  "Almost none",
  "About 10 minutes",
  "About 20 minutes",
  "About 30 minutes",
  "Flexible today",
];

const CONTEXT_OPTIONS: { value: string; label: string }[] = [
  { value: "busy", label: "Busy" },
  { value: "low_capacity", label: "Low capacity" },
  { value: "out_of_routine", label: "Out of routine" },
  { value: "home", label: "At home" },
  { value: "on_the_go", label: "On the go" },
  { value: "social", label: "Social day" },
];

// Display copy per CE-7; internal mode values are unchanged ("minimum" renders
// as "Lightest version").
const MODE_OPTIONS: { value: string; label: string; hint: string }[] = [
  { value: "auto", label: "Choose for me", hint: "Based on this check-in" },
  { value: "minimum", label: "Lightest version", hint: "Only the essentials" },
  { value: "reset", label: "Reset day", hint: "Less output, more recovery" },
  { value: "balanced", label: "Balanced day", hint: "Meals plus a few supporting steps" },
  { value: "custom", label: "Custom", hint: "Choose the areas yourself" },
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

/**
 * Optional baseline seed (Launch v6, Prompt 21). The first check-in after
 * onboarding is prefilled from the user's stored baselines so the sample plan
 * is one tap away. These are starting sliders only — the user can change them,
 * and today's saved draft always wins over the seed.
 */
export type CheckinBaseline = {
  energy?: number;
  stress?: number;
  sleep?: number;
};

export function CheckinForm({ baseline }: { baseline?: CheckinBaseline } = {}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => ({
    ...DEFAULT_DRAFT,
    energy: baseline?.energy ?? DEFAULT_DRAFT.energy,
    stress: baseline?.stress ?? DEFAULT_DRAFT.stress,
    sleep: baseline?.sleep ?? DEFAULT_DRAFT.sleep,
  }));
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
          // Trial-neutral: eligibility (first trial vs pay today) is decided
          // server-side and shown on Billing — never promised here.
          setError(
            "You've used your free sample plan. To keep creating daily plans, choose a Premium plan on the Billing page. Your check-in stays saved on this device."
          );
        } else if (res.status === 429) {
          setError(
            "Plan creation is briefly paced by fair-use limits. Wait a little and try again — your check-in stays saved on this device."
          );
        } else if (res.status === 409) {
          setError(
            "A plan is already being created from this check-in. Give it a few seconds, then open Today."
          );
        } else {
          setError(
            data.error === "onboarding_required"
              ? "Finish the short setup before creating a plan. Your check-in draft will stay here."
              : "Mellowa couldn't shape a new plan just now. Your check-in is saved on this device — try again in a few minutes."
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
      setError(
        "Mellowa couldn't shape a new plan just now. Your check-in is saved on this device — try again in a few minutes."
      );
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
      <Scale label="Energy available today" low="Running low" high="Plenty available" value={draft.energy} onChange={(v) => set("energy", v)} />
      <Scale label="Stress" low="Calm" high="Very stretched" value={draft.stress} onChange={(v) => set("stress", v)} />

      <div>
        <p className="mb-2 text-sm font-medium text-[#1F2937]">
          How much room do you have for yourself?
        </p>
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
          What should the plan prioritize?
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
        Add context only if it would change the plan
      </button>

      {showDetail && (
        <div className="space-y-5 rounded-xl bg-[#FAF7F2] p-4">
          <Scale label="Mood" low="Low" high="Bright" value={draft.mood} onChange={(v) => set("mood", v)} />
          <Scale label="Last night's sleep" low="Rough" high="Restful" value={draft.sleep} onChange={(v) => set("sleep", v)} />
          <div>
            <label className="mb-1 block text-sm font-medium text-[#1F2937]">
              How is eating fitting into today?
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
              One thing worth making easier
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
              Anything else Mellowa should work around?
            </label>
            <textarea
              value={draft.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={3}
              placeholder="Optional — only if it would change the plan."
              className={inputClass}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-[#FEE2E2] px-4 py-3 text-sm text-[#991B1B]">{error}</div>
      )}

      {/* MW-S03: compact pre-generation disclosure of what this plan uses. */}
      <details className="group rounded-xl bg-[#FAF7F2] px-4 py-3 text-xs text-[#6B7280]">
        <summary className="flex cursor-pointer list-none items-center gap-1 font-medium text-[#6B7280]">
          <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" />
          Used for this plan
        </summary>
        <ul className="mt-2 space-y-1">
          <li>• Today&apos;s check-in — energy, stress, time, context and any note (this day only).</li>
          <li>• Your stable preferences — food preferences, allergies, cooking time and skill, movement level.</li>
          <li>• Learned signals from your repeated feedback — visible and removable in Settings.</li>
        </ul>
        <p className="mt-2">
          Nothing else is used. Free-text notes are never kept as memory.
        </p>
      </details>

      <button
        onClick={() => submit("plan")}
        disabled={loading !== null}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#7C9A92] px-4 py-3.5 font-medium text-white transition hover:bg-[#6D8C7D] disabled:opacity-70"
      >
        {loading === "plan" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Matching the plan to your time and energy…
          </>
        ) : (
          "Shape today's plan"
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
            Making the day simpler…
          </>
        ) : (
          <>
            <Feather className="h-4 w-4" />
            Give me the lightest version
          </>
        )}
      </button>
    </div>
  );
}
