"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, Feather, X } from "lucide-react";
import clsx from "clsx";
import { trackClient } from "@/lib/analytics/client";
import { purgeCheckinDraft } from "@/lib/privacy/browser-storage";

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

// MW-S04: routine preset shape returned by /api/presets.
type Preset = {
  id: string;
  name: string;
  context: string | null;
  time_available: string | null;
  mode: string;
  areas: string[];
  weekday_default: number | null;
};

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

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
  // Whether the user has touched the form this session. Used to decide when a
  // weekday-default preset may auto-apply and whether to warn on navigation.
  const dirty = useRef(false);
  // Stable per submission attempt: double clicks and retries of the same
  // submit reuse one key so the server generates at most once (v6 Prompt 7).
  const idemKey = useRef<string | null>(null);

  // MW-V17-03: the check-in draft is NEVER persisted to long-lived
  // browser-readable storage — mood, stress, sleep, hunger, energy, focus,
  // context and notes stay in React memory for this tab only. On mount we purge
  // any legacy `mellowa_checkin_draft` WITHOUT reading it, so an old sensitive
  // draft cannot linger on the device.
  useEffect(() => {
    purgeCheckinDraft();
    // MW-V9-02: the check-in was opened. Surface only — never a signal value.
    trackClient("checkin_started", { surface: "check_in" });
    // MW-S08: arriving from a reminder email — schedule category only.
    try {
      if (new URLSearchParams(window.location.search).get("from") === "reminder") {
        trackClient("reminder_link_opened", { surface: "check_in" });
      }
    } catch {
      /* tracking is never load-bearing */
    }
  }, []);

  // Truthful UX: because the in-progress check-in is kept only in this tab, warn
  // before an accidental reload/close would discard a started, unsubmitted draft.
  // No value is stored or transmitted — the guard only asks to confirm leaving.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current && loading === null) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [loading]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    dirty.current = true;
    setDraft((d) => ({ ...d, [key]: value }));
  };

  // ---- MW-S04: routine presets -----------------------------------------
  // A preset prefills PRACTICAL fields only (time, context, mode, areas) and
  // lists exactly what it filled. Energy/stress and notes always stay fresh
  // inputs, so a preset can never bypass today's capacity check or safety.
  const [presets, setPresets] = useState<Preset[]>([]);
  const [applied, setApplied] = useState<{ name: string; fields: string[] } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [presetWeekday, setPresetWeekday] = useState<string>("");
  const [presetMsg, setPresetMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  function applyPreset(p: Preset, auto = false) {
    const fields: string[] = [];
    setDraft((d) => {
      const next = { ...d };
      if (p.time_available) {
        next.time = p.time_available;
        fields.push(`time: ${p.time_available.toLowerCase()}`);
      }
      if (p.context) {
        next.context = p.context;
        const label = CONTEXT_OPTIONS.find((c) => c.value === p.context)?.label;
        fields.push(`context: ${(label ?? p.context).toLowerCase()}`);
      }
      if (p.mode && p.mode !== "auto") {
        next.mode = p.mode;
        const label = MODE_OPTIONS.find((m) => m.value === p.mode)?.label;
        fields.push(`plan focus: ${(label ?? p.mode).toLowerCase()}`);
      }
      if (p.areas.length) {
        next.areas = p.areas;
        fields.push(`areas: ${p.areas.join(", ")}`);
      }
      return next;
    });
    setApplied({ name: p.name, fields });
    trackClient("preset_applied", {
      surface: "check_in",
      ...(p.context ? { context_type: p.context } : {}),
    });
    if (auto) setPresetMsg(null);
  }

  function removeApplied() {
    setDraft((d) => ({
      ...d,
      time: DEFAULT_DRAFT.time,
      context: DEFAULT_DRAFT.context,
      mode: DEFAULT_DRAFT.mode,
      areas: DEFAULT_DRAFT.areas,
    }));
    setApplied(null);
  }

  useEffect(() => {
    let active = true;
    fetch("/api/presets")
      .then((r) => (r.ok ? r.json() : { presets: [] }))
      .then((d) => {
        if (!active) return;
        const list = (d.presets as Preset[]) ?? [];
        setPresets(list);
        // User-configured weekday default: apply only onto an untouched form,
        // always with the visible "Applied preset" chip and one-tap remove.
        const weekday = (new Date().getDay() + 6) % 7; // 0 = Monday
        const dflt = list.find((p) => p.weekday_default === weekday);
        // Auto-apply a weekday default onto an UNTOUCHED form only. The draft is
        // no longer persisted (MW-V17-03), so "untouched" is an in-memory check.
        if (dflt && !dirty.current) applyPreset(dflt, true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  async function savePreset() {
    const name = presetName.trim();
    if (!name) return;
    setPresetMsg(null);
    try {
      const res = await fetch("/api/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          context: draft.context || null,
          time_available: draft.time || null,
          mode: draft.mode,
          areas: draft.mode === "custom" ? draft.areas : [],
          weekday_default: presetWeekday === "" ? null : Number(presetWeekday),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSaveOpen(false);
        setPresetName("");
        setPresetWeekday("");
        const refreshed = await fetch("/api/presets").then((r) => r.json());
        setPresets((refreshed.presets as Preset[]) ?? []);
      } else {
        setPresetMsg(data.user_message ?? "The preset couldn't be saved — try again.");
      }
    } catch {
      setPresetMsg("The preset couldn't be saved — try again.");
    }
  }

  async function deletePreset(id: string) {
    setConfirmDelete(null);
    setPresets((prev) => prev.filter((p) => p.id !== id));
    try {
      await fetch(`/api/presets?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      /* best effort */
    }
  }

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
            "You've used your free sample plan. To keep creating daily plans, choose a Premium plan on the Billing page. Your check-in is still here on this screen."
          );
        } else if (res.status === 429) {
          setError(
            "Plan creation is briefly paced by fair-use limits. Wait a little and try again — your check-in is still here on this screen."
          );
        } else if (res.status === 409) {
          setError(
            "A plan is already being created from this check-in. Give it a few seconds, then open Today."
          );
        } else {
          setError(
            data.error === "onboarding_required"
              ? "Finish the short setup first — open it from You → Plan preferences → Start onboarding. Your answers are still here on this screen."
              : "Mellowa couldn't shape a new plan just now. Your check-in is still here on this screen — try again in a few minutes."
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
      // The plan is created; the in-memory draft is done. Nothing was persisted,
      // but clear the legacy key defensively in case an old build wrote one.
      dirty.current = false;
      purgeCheckinDraft();
      router.push("/today");
      router.refresh();
    } catch {
      setError(
        "Mellowa couldn't shape a new plan just now. Your check-in is still here on this screen — try again in a few minutes."
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
      {/* MW-S04: routine presets — practical prefill, never energy/stress. */}
      {(presets.length > 0 || applied) && (
        <div>
          <p className="mb-2 text-sm font-medium text-[#1F2937]">
            Start from a routine{" "}
            <span className="font-normal text-[#6B7280]">(optional)</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <span key={p.id} className="inline-flex items-center">
                <button
                  type="button"
                  onClick={() => applyPreset(p)}
                  className={clsx(
                    "rounded-l-full border border-r-0 px-3.5 py-1.5 text-sm transition",
                    applied?.name === p.name
                      ? "border-[#7C9A92] bg-[#7C9A92]/10 font-medium text-[#1F2937]"
                      : "border-[#E5E1DA] bg-white text-[#6B7280] hover:border-[#7C9A92]/50"
                  )}
                >
                  {p.name}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    confirmDelete === p.id ? deletePreset(p.id) : setConfirmDelete(p.id)
                  }
                  aria-label={
                    confirmDelete === p.id
                      ? `Confirm removing preset ${p.name}`
                      : `Remove preset ${p.name}`
                  }
                  className={clsx(
                    "rounded-r-full border border-l-0 px-2 py-1.5 text-xs transition",
                    confirmDelete === p.id
                      ? "border-[#FCA5A5] bg-[#FEE2E2] text-[#991B1B]"
                      : "border-[#E5E1DA] bg-white text-[#9CA3AF] hover:text-[#991B1B]"
                  )}
                >
                  {confirmDelete === p.id ? "Remove?" : <X className="h-3.5 w-3.5" />}
                </button>
              </span>
            ))}
          </div>
          {applied && (
            <div
              className="mt-2 flex items-start justify-between gap-2 rounded-xl bg-[#EEF2FF] px-3 py-2 text-xs text-[#1F2937]"
              aria-live="polite"
            >
              <span>
                Applied preset <span className="font-medium">{applied.name}</span>
                {applied.fields.length > 0 && <> — filled {applied.fields.join("; ")}</>}
                . Energy and stress below are always about today.
              </span>
              <button
                type="button"
                onClick={removeApplied}
                className="shrink-0 font-medium text-[#7C9A92] underline underline-offset-2 hover:text-[#6D8C7D]"
              >
                Remove for today
              </button>
            </div>
          )}
        </div>
      )}

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

      {/* MW-S04: save the practical setup (time/context/focus) for reuse. */}
      {!saveOpen ? (
        <button
          type="button"
          onClick={() => setSaveOpen(true)}
          className="text-sm font-medium text-[#7C9A92] underline underline-offset-2 hover:text-[#6D8C7D]"
        >
          Save current setup as preset
        </button>
      ) : (
        <div className="rounded-xl bg-[#FAF7F2] p-4">
          <p className="text-sm font-medium text-[#1F2937]">Save as preset</p>
          <p className="mt-0.5 text-xs text-[#6B7280]">
            Saves time, context and plan focus only — never today&apos;s energy,
            stress or notes. The name stays private to your list.
          </p>
          <input
            type="text"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            maxLength={40}
            placeholder="e.g. Office day, Late shift, Travel light"
            className={`mt-2 ${inputClass}`}
          />
          <label className="mt-2 block text-xs text-[#6B7280]">
            Use automatically on
            <select
              value={presetWeekday}
              onChange={(e) => setPresetWeekday(e.target.value)}
              className="ml-2 rounded-lg border border-[#E5E1DA] px-2 py-1 text-sm text-[#1F2937]"
            >
              <option value="">No day — apply manually</option>
              {WEEKDAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}s
                </option>
              ))}
            </select>
          </label>
          {presetMsg && (
            <p className="mt-2 text-xs text-[#991B1B]">{presetMsg}</p>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={savePreset}
              disabled={!presetName.trim()}
              className="rounded-xl bg-[#7C9A92] px-3.5 py-2 text-sm font-medium text-white transition hover:bg-[#6D8C7D] disabled:opacity-60"
            >
              Save preset
            </button>
            <button
              type="button"
              onClick={() => setSaveOpen(false)}
              className="rounded-xl border border-[#E5E1DA] px-3.5 py-2 text-sm text-[#6B7280] transition hover:border-[#7C9A92]/50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

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

      {/* MW-V9-02: always-visible compact summary of the choices this plan
          will use. Reflects the live draft; every field above stays editable
          and nothing here is a separate input. Energy/stress/mood and free-text
          notes are deliberately omitted — this is the practical setup only. */}
      <div className="rounded-xl border border-[#E5E1DA] bg-[#FAF7F2] px-4 py-3 text-sm text-[#1F2937]">
        <p className="mb-1.5 font-medium">This plan will use</p>
        <ul className="space-y-0.5 text-[#6B7280]">
          <li>
            Plan focus:{" "}
            <span className="text-[#1F2937]">
              {MODE_OPTIONS.find((m) => m.value === draft.mode)?.label ?? "Choose for me"}
            </span>
            {draft.mode === "custom" && draft.areas.length > 0 && (
              <> — {draft.areas.join(", ")}</>
            )}
          </li>
          <li>
            Time for yourself:{" "}
            <span className="text-[#1F2937]">
              {draft.time ? draft.time.toLowerCase() : "not set yet"}
            </span>
          </li>
          {draft.context && (
            <li>
              Day:{" "}
              <span className="text-[#1F2937]">
                {(CONTEXT_OPTIONS.find((c) => c.value === draft.context)?.label ?? draft.context).toLowerCase()}
              </span>
            </li>
          )}
          <li>Food preferences and any allergy exclusions come from your saved preferences.</li>
        </ul>
        <p className="mt-2 text-xs text-[#9CA3AF]">
          Mellowa will shape meals, a water cue, optional movement and one reset
          around this. Edit anything above before creating the plan.
        </p>
      </div>

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
