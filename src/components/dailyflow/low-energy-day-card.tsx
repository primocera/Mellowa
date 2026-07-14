"use client";

import { useState } from "react";
import { BatteryLow, Loader2, Moon, Sparkles } from "lucide-react";
import type { LowEnergyDayOutputType } from "@/schemas/low-energy-day";

export function LowEnergyDayCard() {
  const [open, setOpen] = useState(false);
  const [availableTime, setAvailableTime] = useState("");
  const [foodAvailable, setFoodAvailable] = useState("");
  const [mustDoTask, setMustDoTask] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [plan, setPlan] = useState<LowEnergyDayOutputType | null>(null);

  async function generate() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/ai/low-energy-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          available_time: availableTime,
          food_available: foodAvailable,
          must_do_task: mustDoTask,
        }),
      });
      const data = await res.json();
      if (data.blocked) {
        setMessage(data.user_message);
      } else if (res.status === 402) {
        setMessage(
          "The low-energy day plan is part of Mellowa Premium. Start your free trial to unlock it."
        );
      } else if (res.ok && data.plan) {
        setPlan(data.plan);
      } else {
        setMessage("Couldn't create a plan right now — try again in a moment.");
      }
    } catch {
      setMessage("Couldn't create a plan right now — try again in a moment.");
    }
    setLoading(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-2xl border border-[#EDE9FE] bg-[#EDE9FE]/40 p-4 text-left transition hover:bg-[#EDE9FE]/70"
      >
        <span className="rounded-xl bg-white p-2 shadow-sm">
          <BatteryLow className="h-5 w-5 text-[#7C9A92]" />
        </span>
        <span>
          <span className="block text-sm font-medium text-[#1F2937]">
            Low-energy day?
          </span>
          <span className="block text-sm text-[#6B7280]">
            Get a very small plan so today doesn&apos;t collapse.
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-[#EDE9FE] bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <BatteryLow className="h-5 w-5 text-[#7C9A92]" />
        <h2 className="font-medium text-[#1F2937]">Low-energy day plan</h2>
      </div>

      {!plan && (
        <>
          <p className="text-sm text-[#6B7280]">
            No pressure today. Answer what you can — everything is optional.
          </p>
          <div className="space-y-3">
            <input
              value={availableTime}
              onChange={(e) => setAvailableTime(e.target.value)}
              maxLength={200}
              placeholder="How much time/energy do you have? (e.g. almost none)"
              className="w-full rounded-xl border border-[#E5E1DA] px-3 py-2 text-sm text-[#1F2937] placeholder:text-[#9CA3AF] focus:border-[#7C9A92] focus:outline-none"
            />
            <input
              value={foodAvailable}
              onChange={(e) => setFoodAvailable(e.target.value)}
              maxLength={500}
              placeholder="What food do you have at home? (optional)"
              className="w-full rounded-xl border border-[#E5E1DA] px-3 py-2 text-sm text-[#1F2937] placeholder:text-[#9CA3AF] focus:border-[#7C9A92] focus:outline-none"
            />
            <input
              value={mustDoTask}
              onChange={(e) => setMustDoTask(e.target.value)}
              maxLength={300}
              placeholder="One thing that really must happen today? (optional)"
              className="w-full rounded-xl border border-[#E5E1DA] px-3 py-2 text-sm text-[#1F2937] placeholder:text-[#9CA3AF] focus:border-[#7C9A92] focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={generate}
              disabled={loading}
              className="flex items-center gap-2 rounded-xl bg-[#7C9A92] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#6D8C7D] disabled:opacity-70"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {loading ? "Making it small..." : "Create my tiny plan"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-sm text-[#6B7280] hover:text-[#1F2937]"
            >
              Not now
            </button>
          </div>
        </>
      )}

      {message && (
        <p className="rounded-xl bg-[#EEF2FF] px-3 py-2 text-sm text-[#1F2937]">
          {message}
        </p>
      )}

      {plan && (
        <div className="space-y-4">
          <div>
            <h3 className="text-base font-semibold text-[#1F2937]">
              {plan.title}
            </h3>
            <p className="mt-1 text-sm text-[#6B7280]">{plan.message}</p>
          </div>

          <div className="rounded-xl bg-[#FAF7F2] p-4">
            <p className="text-sm font-medium text-[#1F2937]">
              Today&apos;s minimum
            </p>
            <ul className="mt-2 space-y-2">
              {plan.minimum_day_plan.map((item, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#7C9A92]" />
                  <span>
                    <span className="font-medium text-[#1F2937]">
                      {item.title}
                    </span>
                    {item.time_hint && (
                      <span className="ml-2 text-[#9CA3AF]">
                        {item.time_hint}
                      </span>
                    )}
                    {item.description && (
                      <span className="block text-[#6B7280]">
                        {item.description}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl bg-[#FAF7F2] p-4">
            <p className="text-sm font-medium text-[#1F2937]">Easy food</p>
            <ul className="mt-2 space-y-2">
              {plan.easy_meals.map((m, i) => (
                <li key={i} className="text-sm">
                  <span className="font-medium text-[#1F2937]">{m.meal}:</span>{" "}
                  <span className="text-[#6B7280]">{m.idea}</span>
                  {m.why_it_fits && (
                    <span className="block text-xs text-[#9CA3AF]">
                      {m.why_it_fits}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl bg-[#EDE9FE]/50 p-4">
            <p className="text-sm font-medium text-[#1F2937]">
              One small reset — {plan.one_reset.title}
              {plan.one_reset.duration && (
                <span className="ml-2 font-normal text-[#9CA3AF]">
                  {plan.one_reset.duration}
                </span>
              )}
            </p>
            <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-[#6B7280]">
              {plan.one_reset.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </div>

          <div className="rounded-xl bg-[#FAF7F2] p-4 text-sm">
            <p className="font-medium text-[#1F2937]">One tiny habit</p>
            <p className="mt-1 text-[#6B7280]">
              {plan.one_tiny_habit.habit}{" "}
              <span className="text-[#9CA3AF]">
                — minimum: {plan.one_tiny_habit.minimum_version}
              </span>
            </p>
          </div>

          <div className="rounded-xl bg-[#FAF7F2] p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-[#1F2937]">
              <Moon className="h-4 w-4 text-[#7C9A92]" /> Evening recovery
            </p>
            <ul className="mt-2 space-y-1 text-sm text-[#6B7280]">
              {plan.evening_recovery.map((s, i) => (
                <li key={i}>• {s}</li>
              ))}
            </ul>
          </div>

          <p className="text-sm text-[#1F2937]">{plan.encouragement}</p>
          {plan.safety_note && (
            <p className="text-xs text-[#9CA3AF]">{plan.safety_note}</p>
          )}
        </div>
      )}
    </div>
  );
}
