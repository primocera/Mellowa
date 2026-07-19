"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PenLine } from "lucide-react";
import type { JournalEntry } from "@/types/dailyflow";
import clsx from "clsx";

const PROMPTS = [
  { category: "Evening reflection", text: "What felt steady today, even if small?" },
  { category: "Lighter day", text: "Today was heavy — what would 'good enough' look like tonight?" },
  { category: "Stress reset", text: "What helped you pause today, even for a moment?" },
  { category: "Food routine", text: "How did meals fit into your day — what felt easy, what felt rushed?" },
  { category: "Habit review", text: "Which habit felt natural this week, and which felt forced?" },
  { category: "What worked", text: "Name one thing that worked today — however small." },
];

type Reflection = {
  reflection: string;
  gentle_question: string;
  one_small_action: string;
};

function MoodPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-[#6B7280]">{label}</p>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={clsx(
              "h-8 w-8 rounded-lg border text-xs font-medium transition",
              value === n
                ? "border-[#7C9A92] bg-[#7C9A92] text-white"
                : "border-[#E5E1DA] bg-white text-[#6B7280]"
            )}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

export function JournalView({ entries }: { entries: JournalEntry[] }) {
  const router = useRouter();
  const dayPrompt = PROMPTS[new Date().getDate() % PROMPTS.length];

  const [prompt, setPrompt] = useState(dayPrompt.text);
  const [answer, setAnswer] = useState("");
  const [moodBefore, setMoodBefore] = useState<number | null>(null);
  const [moodAfter, setMoodAfter] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [reflection, setReflection] = useState<Reflection | null>(null);
  const [safetyMessage, setSafetyMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setLoading(true);
    setError(null);
    setSafetyMessage(null);
    setReflection(null);
    try {
      const res = await fetch("/api/ai/journal-reflection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          answer,
          mood_before: moodBefore ?? undefined,
          mood_after: moodAfter ?? undefined,
        }),
      });
      const data = await res.json();
      if (data.blocked) {
        setSafetyMessage(data.user_message);
      } else if (res.ok && data.saved) {
        setReflection(data.reflection);
        setAnswer("");
        setMoodBefore(null);
        setMoodAfter(null);
        router.refresh();
      } else {
        setError(
          "This entry didn't save. Your text is still here — please try again."
        );
      }
    } catch {
      setError(
        "This entry didn't save. Your text is still here — please try again."
      );
    }
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-[#9CA3AF]">
          {dayPrompt.category}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PROMPTS.map((p) => (
            <button
              key={p.text}
              type="button"
              onClick={() => setPrompt(p.text)}
              className={clsx(
                "rounded-full border px-3 py-1 text-xs transition",
                prompt === p.text
                  ? "border-[#7C9A92] bg-[#7C9A92]/10 text-[#1F2937]"
                  : "border-[#E5E1DA] text-[#6B7280] hover:border-[#7C9A92]/50"
              )}
            >
              {p.category}
            </button>
          ))}
        </div>
        <p className="mt-4 text-sm font-medium text-[#1F2937]">{prompt}</p>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={5}
          placeholder="Write in your own words. No structure needed."
          className="mt-3 w-full rounded-xl border border-[#E5E1DA] px-4 py-3 text-sm text-[#1F2937] placeholder:text-[#9CA3AF] focus:border-[#7C9A92] focus:outline-none"
        />
        <div className="mt-3 flex flex-wrap gap-6">
          <MoodPicker label="Mood before (optional)" value={moodBefore} onChange={setMoodBefore} />
          <MoodPicker label="Mood after (optional)" value={moodAfter} onChange={setMoodAfter} />
        </div>

        {safetyMessage && (
          <div className="mt-4 rounded-xl bg-[#EEF2FF] px-4 py-3 text-sm leading-relaxed text-[#1F2937]">
            {safetyMessage}
          </div>
        )}
        {error && (
          <div className="mt-4 rounded-xl bg-[#FEE2E2] px-4 py-3 text-sm text-[#991B1B]">
            {error}
          </div>
        )}

        <p className="mt-4 text-xs leading-relaxed text-[#9CA3AF]">
          Saving sends this entry to our AI provider for a general written
          reflection. Entries are private and not monitored by anyone — this
          isn&rsquo;t therapy or crisis support. If you&rsquo;re in a difficult
          place, please reach out to someone qualified or someone you trust.
        </p>
        <button
          onClick={save}
          disabled={loading || !answer.trim()}
          className="mt-4 flex items-center gap-2 rounded-xl bg-[#7C9A92] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#6D8C7D] disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
          Save entry
        </button>
      </div>

      {reflection && (
        <div className="rounded-2xl bg-[#EDE9FE]/60 p-6">
          <p className="text-xs font-medium uppercase tracking-wide text-[#6B7280]">
            AI-generated reflection — keep only what feels useful
          </p>
          <p className="mt-2 text-sm text-[#1F2937]">{reflection.reflection}</p>
          <p className="mt-3 text-sm font-medium text-[#1F2937]">{reflection.gentle_question}</p>
          <p className="mt-3 rounded-xl bg-white/70 px-4 py-3 text-sm text-[#1F2937]">
            One small action: {reflection.one_small_action}
          </p>
        </div>
      )}

      {entries.length > 0 && (
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="font-medium text-[#1F2937]">Previous entries</h2>
          <ul className="mt-3 space-y-4">
            {entries.map((entry) => (
              <li key={entry.id} className="border-t border-[#F3F0EA] pt-3 first:border-t-0 first:pt-0">
                <p className="text-xs text-[#9CA3AF]">{entry.entry_date}</p>
                {entry.prompt && (
                  <p className="mt-0.5 text-xs italic text-[#6B7280]">{entry.prompt}</p>
                )}
                <p className="mt-1 whitespace-pre-wrap text-sm text-[#1F2937]">{entry.answer}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
