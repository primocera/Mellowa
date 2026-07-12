"use client";

import { useState } from "react";
import { Loader2, UtensilsCrossed } from "lucide-react";
import clsx from "clsx";

type MealIdea = {
  meal_type: string;
  title: string;
  description?: string;
  prep_time?: string;
};

type MealRhythm = { title: string; ideas: MealIdea[]; notes?: string };

const CHALLENGES = [
  "Skipping breakfast",
  "Chaotic lunch",
  "Evening overeating",
  "No cooking time",
  "Low appetite",
  "Cravings",
];

const GROUP_LABELS: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snacks",
  low_energy_backup: "Low-energy backups",
};

export function MealRhythmView({ initial }: { initial: MealRhythm | null }) {
  const [challenge, setChallenge] = useState("");
  const [rhythm, setRhythm] = useState<MealRhythm | null>(initial);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/ai/meal-rhythm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge }),
      });
      const data = await res.json();
      if (data.blocked) {
        setMessage(data.user_message);
      } else if (res.ok && data.ideas) {
        setRhythm(data.ideas);
      } else {
        setMessage("Couldn't create meal ideas right now — try again in a moment.");
      }
    } catch {
      setMessage("Couldn't create meal ideas right now — try again in a moment.");
    }
    setLoading(false);
  }

  const groups = (rhythm?.ideas ?? []).reduce<Record<string, MealIdea[]>>(
    (acc, idea) => {
      (acc[idea.meal_type] ??= []).push(idea);
      return acc;
    },
    {}
  );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="font-medium text-[#1F2937]">
          What&apos;s the trickiest meal moment right now?
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {CHALLENGES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setChallenge((prev) => (prev === c ? "" : c))}
              className={clsx(
                "rounded-full border px-3.5 py-1.5 text-sm transition",
                challenge === c
                  ? "border-[#7C9A92] bg-[#7C9A92]/10 font-medium text-[#1F2937]"
                  : "border-[#E5E1DA] bg-white text-[#6B7280] hover:border-[#7C9A92]/50"
              )}
            >
              {c}
            </button>
          ))}
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className="mt-4 flex items-center gap-2 rounded-xl bg-[#7C9A92] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#6D8C7D] disabled:opacity-70"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <UtensilsCrossed className="h-4 w-4" />
          )}
          {loading
            ? "Putting together simple ideas..."
            : rhythm
              ? "Get fresh ideas"
              : "Get meal rhythm ideas"}
        </button>
        {message && (
          <p className="mt-3 rounded-xl bg-[#EEF2FF] px-3 py-2 text-sm text-[#1F2937]">
            {message}
          </p>
        )}
      </div>

      {rhythm && (
        <>
          {Object.entries(GROUP_LABELS).map(([key, label]) =>
            groups[key]?.length ? (
              <div key={key} className="rounded-2xl bg-white p-5 shadow-sm">
                <h2 className="font-medium text-[#1F2937]">{label}</h2>
                <ul className="mt-3 space-y-3">
                  {groups[key].map((idea, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#7C9A92]" />
                      <div>
                        <p className="text-sm font-medium text-[#1F2937]">
                          {idea.title}
                          {idea.prep_time && (
                            <span className="ml-2 font-normal text-[#9CA3AF]">
                              {idea.prep_time}
                            </span>
                          )}
                        </p>
                        {idea.description && (
                          <p className="text-sm text-[#6B7280]">{idea.description}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null
          )}
          {rhythm.notes && (
            <div className="rounded-2xl bg-[#EDE9FE]/60 p-5 text-sm text-[#1F2937]">
              {rhythm.notes}
            </div>
          )}
        </>
      )}
    </div>
  );
}
