"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
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

export function CheckinForm() {
  const router = useRouter();
  const [energy, setEnergy] = useState(3);
  const [mood, setMood] = useState(3);
  const [stress, setStress] = useState(3);
  const [sleep, setSleep] = useState(3);
  const [hunger, setHunger] = useState("");
  const [time, setTime] = useState("");
  const [focus, setFocus] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [safetyMessage, setSafetyMessage] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setSafetyMessage(null);
    setLoading(true);

    try {
      const res = await fetch("/api/ai/daily-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          energy_level: energy,
          mood_level: mood,
          stress_level: stress,
          sleep_quality: sleep,
          hunger_pattern: hunger,
          time_available: time,
          today_focus: focus,
          notes,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 402) {
          setError(
            "You've used this month's free plans. Upgrade to Premium on the Billing page for unlimited daily plans."
          );
        } else {
          setError(
            data.error === "onboarding_required"
              ? "Please finish onboarding first."
              : "Something went wrong. Please try again."
          );
        }
        setLoading(false);
        return;
      }

      if (data.blocked) {
        setSafetyMessage(data.user_message);
        setLoading(false);
        return;
      }

      router.push("/today");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
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

  return (
    <div className="space-y-5 rounded-2xl bg-white p-6 shadow-sm sm:p-8">
      <Scale label="Energy today" low="Running on empty" high="Feeling great" value={energy} onChange={setEnergy} />
      <Scale label="Mood" low="Low" high="Bright" value={mood} onChange={setMood} />
      <Scale label="Stress" low="Calm" high="Very stressed" value={stress} onChange={setStress} />
      <Scale label="Last night's sleep" low="Rough" high="Restful" value={sleep} onChange={setSleep} />

      <div>
        <label className="mb-1 block text-sm font-medium text-[#1F2937]">
          How&apos;s your appetite today? <span className="font-normal text-[#6B7280]">(optional)</span>
        </label>
        <input
          type="text"
          value={hunger}
          onChange={(e) => setHunger(e.target.value)}
          placeholder="e.g. barely hungry in the morning, snacky at night"
          className="w-full rounded-xl border border-[#E5E1DA] px-4 py-3 text-[#1F2937] placeholder:text-[#9CA3AF] focus:border-[#7C9A92] focus:outline-none"
        />
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-[#1F2937]">Time for yourself today</p>
        <div className="grid grid-cols-2 gap-2">
          {TIME_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setTime(opt)}
              className={clsx(
                "rounded-xl border px-3 py-2.5 text-sm transition",
                time === opt
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
        <label className="mb-1 block text-sm font-medium text-[#1F2937]">
          One thing you&apos;d like to focus on <span className="font-normal text-[#6B7280]">(optional)</span>
        </label>
        <input
          type="text"
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          placeholder="e.g. eat a real lunch, short walk, earlier bedtime"
          className="w-full rounded-xl border border-[#E5E1DA] px-4 py-3 text-[#1F2937] placeholder:text-[#9CA3AF] focus:border-[#7C9A92] focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-[#1F2937]">
          Anything else on your mind? <span className="font-normal text-[#6B7280]">(optional)</span>
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Totally optional — whatever helps your plan fit today."
          className="w-full rounded-xl border border-[#E5E1DA] px-4 py-3 text-[#1F2937] placeholder:text-[#9CA3AF] focus:border-[#7C9A92] focus:outline-none"
        />
      </div>

      {error && (
        <div className="rounded-xl bg-[#FEE2E2] px-4 py-3 text-sm text-[#991B1B]">{error}</div>
      )}

      <button
        onClick={submit}
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#7C9A92] px-4 py-3.5 font-medium text-white transition hover:bg-[#6D8C7D] disabled:opacity-70"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Building a realistic plan for today...
          </>
        ) : (
          "Create today's plan"
        )}
      </button>
    </div>
  );
}
