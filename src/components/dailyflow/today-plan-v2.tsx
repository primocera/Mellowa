"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  RefreshCw,
  Feather,
  Check,
  Droplets,
  Footprints,
  Wind,
  Brain,
  Sparkles,
  Moon,
  Target,
  ChevronDown,
} from "lucide-react";
import Link from "next/link";
import clsx from "clsx";
import { SaveMealButton } from "@/components/dailyflow/save-meal-button";
import { createClient } from "@/lib/supabase/client";
import { PlanFeedback } from "@/components/dailyflow/plan-feedback";
import type {
  MealCardType,
  MovementMomentType,
} from "@/schemas/ai-output-v2";
import { isLighterDay, pickCalmReset } from "@/lib/today/disclosure";
import { nextAction, type NowItem } from "@/lib/today/next-action";
import { deterministicDiff } from "@/lib/plan/repair";
import { trackClient } from "@/lib/analytics/client";
import { buttonClass } from "@/components/ui";
import { useRouter } from "next/navigation";

// MW-S07: honest entitlement copy per server decision. Trial eligibility is
// decided server-side and shown only on Billing — never promised here.
function entitlementMessage(code: string | undefined): string {
  if (code === "sample_adjustment_used") {
    return "Your free sample included one adjustment, and it's been used — everything you created stays readable. Ongoing daily adjustments, weekly continuity, preference learning and meal planning are part of Premium (see Billing).";
  }
  return "Meal swaps and new plans are part of Premium. Your free sample includes one non-meal adjustment — a simpler movement, calm reset or evening option. See Billing for plans.";
}

function newAttemptKey(): string {
  return (crypto.randomUUID?.() ?? `r-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 64);
}

// ---- shapes stored on the plan row (jsonb) ----
type Summary = { main_focus: string; energy_match?: string; short_note?: string };
type Hydration = { goal: string; timing: string[] };
type Breathing = { name: string; duration_minutes: number; when_to_use?: string; steps: string[]; gentle_note?: string };
type Meditation = { name: string; duration_minutes: number; script: string[]; journal_prompt?: string };
type Relaxation = { name: string; duration_minutes: number; steps: string[]; best_for?: string };
type FocusBlock = { main_task: string; method?: string; break_reminder?: string };
type Evening = { time?: string; steps: string[]; simple_version?: string };
type Habit = { habit: string; minimum_version: string; tracking_question?: string };

type PlanRow = {
  id: string;
  plan_summary: Summary | null;
  plan_intensity: string | null;
  plan_mode?: string | null;
  meal_cards: MealCardType[] | null;
  hydration_plan_v2: Hydration | null;
  movement_plan: MovementMomentType | null;
  breathing_exercise: Breathing | null;
  meditation_or_reflection: Meditation | null;
  relaxation_technique: Relaxation | null;
  focus_plan: FocusBlock | null;
  evening_routine: Evening | null;
  habit_focus: Habit | null;
  encouragement: string | null;
  safety_note: string | null;
};

const INTENSITY_LABELS: Record<string, string> = {
  normal: "Balanced day",
  low_energy: "Lighter day",
  high_stress: "Calm day",
  busy_day: "Busy day",
};

const MODE_LABELS: Record<string, string> = {
  minimum: "Lightest version",
  balanced: "Balanced day",
  reset: "Reset day",
  custom: "Your custom day",
};

// AI-provided names may be verbose or clinical; they can label a block but
// never override the canonical hierarchy (CE-8). Long or empty names fall
// back to the canonical section title.
function sectionName(aiName: string | undefined | null, fallback: string): string {
  const n = (aiName ?? "").trim();
  return n && n.length <= 48 ? n : fallback;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function Section({
  icon,
  title,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="font-medium text-[#1F2937]">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function MacroPills({ macros }: { macros: MealCardType["approximate_macros"] }) {
  const items = [
    `${Math.round(macros.calories)} kcal`,
    `P ${Math.round(macros.protein_g)}g`,
    `C ${Math.round(macros.carbs_g)}g`,
    `F ${Math.round(macros.fat_g)}g`,
  ];
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {items.map((t) => (
        <span
          key={t}
          className="rounded-full bg-[#FAF7F2] px-2.5 py-0.5 text-xs text-[#6B7280]"
        >
          {t}
        </span>
      ))}
      <span className="rounded-full bg-[#FAF7F2] px-2.5 py-0.5 text-xs text-[#9CA3AF]">
        approximate
      </span>
    </div>
  );
}

export function TodayPlanV2({
  plan,
  showMacros,
  completedKeys = [],
  isPremium = false,
}: {
  plan: PlanRow;
  showMacros: boolean;
  completedKeys?: string[];
  /** Whole-day adjust is Premium-only; free/sample users see the prompt up
   *  front instead of committing into a server-side paywall. */
  isPremium?: boolean;
}) {
  const [meals, setMeals] = useState<MealCardType[]>(plan.meal_cards ?? []);
  // Per-card hide control (Prompt 7): hiding persists as the account-wide
  // opt-out; estimates never reappear without an explicit opt-in.
  const [macrosVisible, setMacrosVisible] = useState(showMacros);
  async function hideMacros() {
    setMacrosVisible(false);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from("wellbeing_profiles")
          .update({ show_macros: false })
          .eq("user_id", user.id);
      }
    } catch {
      // UI already hidden; preference retry available in Settings.
    }
  }
  const [movement, setMovement] = useState<MovementMomentType | null>(
    plan.movement_plan
  );
  // Meals and movement are the only sections held in local state (for per-card
  // regenerate / hide). After an adjustment the parent server component
  // refreshes with the repaired plan, but that local state was seeded at mount,
  // so without this sync the two most prominent sections would keep showing the
  // pre-adjustment content while every prop-rendered section updated — the plan
  // would look unchanged. Re-seed whenever the server sends a new plan version.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMeals(plan.meal_cards ?? []);
    setMovement(plan.movement_plan);
  }, [plan.id, plan.meal_cards, plan.movement_plan]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [simplifying, setSimplifying] = useState(false);
  const router = useRouter();
  // MW-S02 repair sheet state.
  const [repairOpen, setRepairOpen] = useState(false);
  const [repairReason, setRepairReason] = useState<string | null>(null);
  const [repairNote, setRepairNote] = useState("");
  const [keptKeys, setKeptKeys] = useState<Set<string>>(new Set());
  // MW-V9-04: the committed repair's factual result. The diff shown to the
  // user is derived from server-computed changed_sections/counts + the stored
  // version number — the model-written summary is context only.
  const [repairResult, setRepairResult] = useState<{
    summary: string;
    changed: string[];
    keptCount: number;
    completedCount: number;
    version: number | null;
  } | null>(null);
  const [repairAttemptKey, setRepairAttemptKey] = useState(newAttemptKey);
  // MW-V10-03: this page is showing a plan the server has since moved past —
  // another tab adjusted it, or a request was already claimed. The only correct
  // action is to move FORWARD to the server's version, so the state carries the
  // explanation and the reload, and never an option to overwrite the newer plan.
  const [staleView, setStaleView] = useState<string | null>(null);
  const [doneItems, setDoneItems] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(completedKeys.map((k) => [k, true]))
  );

  // ---- MW-S01: Now view state -------------------------------------------
  // "Not now" deferrals live in localStorage per plan (device-only, bounded
  // reason codes, no server storage) so they survive a refresh but reset with
  // a new plan. Nothing here reorders or mutates the stored plan JSON.
  const deferralStorageKey = `mellowa_now_deferred:${plan.id}`;
  const [deferred, setDeferred] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(deferralStorageKey);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((k) => typeof k === "string") : [];
    } catch {
      return [];
    }
  });
  // Local time is read once per visit; the phase is a broad window, so a
  // minute-level tick isn't needed and keeps selection stable while reading.
  const [nowMinutes] = useState(
    () => new Date().getHours() * 60 + new Date().getMinutes()
  );
  const [showFull, setShowFull] = useState(false);
  const [deferOpen, setDeferOpen] = useState(false);
  // MW-V9-03: after Done on the Now card the item leaves selection and the next
  // action appears. Keep a short, explicit undo/unmark for the item just marked
  // so a mistaken tap is one click to reverse.
  const [justDone, setJustDone] = useState<string | null>(null);
  const planModeCategory = (
    plan.plan_mode && ["minimum", "balanced", "reset", "custom"].includes(plan.plan_mode)
      ? plan.plan_mode
      : "unknown"
  ) as "minimum" | "balanced" | "reset" | "custom" | "unknown";

  const doneKeys = useMemo(
    () => Object.keys(doneItems).filter((k) => doneItems[k]),
    [doneItems]
  );
  const nowSelection = useMemo(
    () => nextAction(plan, doneKeys, nowMinutes, deferred),
    [plan, doneKeys, nowMinutes, deferred]
  );

  useEffect(() => {
    trackClient("now_viewed", { plan_mode: planModeCategory });
    // Fire once per visit to Today, whatever the selection state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function deferNow(item: NowItem, reason: string) {
    setDeferOpen(false);
    setJustDone(null);
    setDeferred((prev) => {
      const next = prev.includes(item.key) ? prev : [...prev, item.key];
      try {
        window.localStorage.setItem(deferralStorageKey, JSON.stringify(next));
      } catch {
        /* session-only fallback */
      }
      return next;
    });
    trackClient("now_action_deferred", {
      plan_mode: planModeCategory,
      item_type: item.type,
      defer_reason: reason,
    });
  }

  const summary = plan.plan_summary;
  const intensity = plan.plan_intensity ?? "normal";

  // Prompt 11: progressive disclosure by mode. On lighter days we don't push
  // a productivity "focus block" — the plan should feel calmer, not busier.
  const mode = plan.plan_mode ?? intensity;
  const showFocus = !!plan.focus_plan && !isLighterDay(mode);

  // Prompt 11: offer ONE calm reset, not all three at once.
  const calmReset = pickCalmReset({
    breathing: plan.breathing_exercise,
    meditation: plan.meditation_or_reflection,
    relaxation: plan.relaxation_technique,
  });

  // MW-S02: preview list for the repair sheet — every plan item with its
  // completion key, so the user sees exactly what is kept vs. replaceable.
  const planItems: { key: string; label: string }[] = [
    ...meals.map((m) => ({
      key: `meal:${m.meal_type}`,
      label: `${m.meal_type.charAt(0).toUpperCase()}${m.meal_type.slice(1)} — ${m.title}`,
    })),
    ...(movement ? [{ key: "movement", label: `Movement — ${movement.title}` }] : []),
    ...(calmReset ? [{ key: calmReset, label: "Calm reset" }] : []),
    ...(showFocus && plan.focus_plan
      ? [{ key: "focus", label: "Focus block" }]
      : []),
    ...(plan.evening_routine ? [{ key: "evening", label: "Evening wind-down" }] : []),
    ...(plan.habit_focus ? [{ key: "habit", label: `Habit — ${plan.habit_focus.habit}` }] : []),
  ];

  // MW-V10-03: completion is server-confirmed, and one item can have only one
  // request in flight.
  //
  // Two failures this closes. First, a double tap used to fire two requests
  // whose responses could land in either order, leaving the UI showing a state
  // the database does not have. Second, the Now card set its "Marked done"
  // confirmation immediately, so a failed save still told the user the item was
  // done. Now the optimistic paint is reconciled against the server's own
  // `{ item_key, done }` reply, and the confirmation only appears after it.
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());

  const toggleDone = async (key: string, source: "now" | "plan" = "plan") => {
    // A second tap while the first is in flight is a duplicate, not a toggle
    // back — dropping it is what makes double-tap idempotent.
    if (savingKeys.has(key)) return;
    const next = !doneItems[key];
    setSavingKeys((s) => new Set(s).add(key));
    setDoneItems((d) => ({ ...d, [key]: next }));
    try {
      const res = await fetch("/api/plan/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: plan.id, item_key: key, done: next, source }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || typeof data?.done !== "boolean") {
        throw new Error("save failed");
      }
      // Trust the server's answer, not the guess we painted.
      setDoneItems((d) => ({ ...d, [key]: data.done }));
      if (data.done && source === "now") setJustDone(key);
      else if (!data.done) setJustDone((j) => (j === key ? null : j));
    } catch {
      setDoneItems((d) => ({ ...d, [key]: !next }));
      setJustDone((j) => (j === key ? null : j));
      setMessage(
        next
          ? "That didn't save, so it isn't marked done — nothing else about your plan changed. Tap it again to retry."
          : "That didn't save, so it's still marked done — nothing else about your plan changed. Tap it again to retry."
      );
    } finally {
      setSavingKeys((s) => {
        const n = new Set(s);
        n.delete(key);
        return n;
      });
    }
  };

  async function regenerateMeal(mealType: string, reason: string) {
    setBusy(`meal:${mealType}`);
    setMessage(null);
    try {
      const res = await fetch("/api/ai/regenerate-section", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_id: plan.id,
          section_name: "meal_card",
          meal_type: mealType,
          reason,
        }),
      });
      const data = await res.json();
      if (data.blocked) setMessage(data.user_message);
      else if (res.ok && data.section) {
        setMeals((prev) =>
          prev.map((m) => (m.meal_type === mealType ? data.section : m))
        );
      } else if (res.status === 402) {
        setMessage(entitlementMessage(data.error));
        trackClient("premium_value_explained", { surface: "today" });
      } else setMessage("Couldn't update that meal — try again in a moment.");
    } catch {
      setMessage("Couldn't update that meal — try again in a moment.");
    }
    setBusy(null);
  }

  async function regenerateMovement() {
    setBusy("movement");
    setMessage(null);
    try {
      const res = await fetch("/api/ai/regenerate-section", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_id: plan.id,
          section_name: "movement_moment",
          reason: "make_easier",
        }),
      });
      const data = await res.json();
      if (data.blocked) setMessage(data.user_message);
      else if (res.ok && data.section) {
        setMovement(data.section);
        if (data.sample_adjustment) {
          setMessage(
            "That was your sample's included adjustment — the result is yours to keep. Premium adds ongoing daily adjustments, weekly continuity, preference learning and meal planning."
          );
        }
      } else if (res.status === 402) {
        setMessage(entitlementMessage(data.error));
        trackClient("premium_value_explained", { surface: "today" });
      } else setMessage("Couldn't update movement — try again in a moment.");
    } catch {
      setMessage("Couldn't update movement — try again in a moment.");
    }
    setBusy(null);
  }

  // MW-S02: one atomic "Adjust the rest of today" request instead of the old
  // per-section loop — a repair commits fully or not at all, and Undo is free.
  async function submitRepair() {
    if (!repairReason) return;
    setSimplifying(true);
    setMessage(null);
    try {
      const res = await fetch("/api/ai/plan-repair", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-idempotency-key": repairAttemptKey,
        },
        body: JSON.stringify({
          plan_id: plan.id,
          reason: repairReason,
          keep_keys: Array.from(keptKeys),
          user_note: repairNote.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.blocked) {
        setMessage(data.user_message);
        setRepairOpen(false);
      } else if (res.status === 409) {
        // MW-V10-03: the request was claimed by an earlier attempt (double tap,
        // a retry, or a second tab). Never a duplicate generation and never a
        // second charge against fair use — say what is happening and offer the
        // reload that shows whichever plan actually committed.
        setRepairOpen(false);
        setStaleView(
          "This adjustment is already being created — your tap didn't start a second one. Reload to see the result."
        );
      } else if (res.ok && data.deduplicated) {
        // The same attempt key already succeeded; the newer plan is on the
        // server, so reload rather than claiming a fresh adjustment.
        setRepairOpen(false);
        setStaleView(
          "That adjustment had already gone through. Reload to see the plan you have now."
        );
      } else if (res.ok && data.repair_summary) {
        setRepairResult({
          summary: data.repair_summary as string,
          changed: Array.isArray(data.changed_sections) ? data.changed_sections : [],
          keptCount: typeof data.kept_count === "number" ? data.kept_count : keptKeys.size,
          completedCount:
            typeof data.completed_count === "number"
              ? data.completed_count
              : Object.values(doneItems).filter(Boolean).length,
          version: typeof data.version === "number" ? data.version : null,
        });
        setRepairOpen(false);
        router.refresh();
      } else if (res.status === 402) {
        setMessage(entitlementMessage(data.error));
        trackClient("premium_value_explained", { surface: "today" });
      } else {
        setMessage(
          data.user_message ??
            "The adjustment didn't come through. Your previous plan is unchanged. Please try again."
        );
      }
    } catch {
      setMessage(
        "The adjustment didn't come through. Your previous plan is unchanged. Please try again."
      );
    }
    setRepairAttemptKey(newAttemptKey());
    setSimplifying(false);
  }

  async function undoRepair() {
    setSimplifying(true);
    try {
      const res = await fetch("/api/ai/plan-repair", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        // MW-V9-04: undo exactly the version this page showed. A newer repair
        // from another tab returns a 409 instead of being silently unwound.
        body: JSON.stringify({
          plan_id: plan.id,
          expected_version: repairResult?.version ?? undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.undone) {
        setRepairResult(null);
        setMessage("Undone — your previous plan is back.");
        router.refresh();
      } else if (res.ok && !data.undone) {
        setRepairResult(null);
        setMessage("There's no earlier version of this plan to restore.");
        router.refresh();
      } else if (res.status === 409) {
        // MW-V10-03: a newer adjustment exists — from another tab, or from this
        // page left open too long. The newer plan is kept: undoing to the
        // version THIS page remembers would silently discard work the user did
        // somewhere else. Reload forward, never backward.
        setRepairResult(null);
        setStaleView(
          "A newer adjustment was made since this page loaded, so nothing was undone — that newer plan is the one you have. Reload to see it."
        );
      } else {
        setMessage(data.user_message ?? "Undo didn't go through — please try again.");
      }
    } catch {
      setMessage("Undo didn't go through — please try again.");
    }
    setSimplifying(false);
  }

  return (
    <div className="space-y-4">
      {/* 1. Header + summary */}
      <div className="rounded-2xl bg-[#7C9A92] p-6 text-white">
        <p className="text-sm text-white/80">{greeting()}. Here&apos;s what fits today.</p>
        <h1 className="mt-1 text-lg font-semibold">
          {summary?.main_focus ?? "A realistic plan for today"}
        </h1>
        {summary?.short_note && (
          <p className="mt-1 text-sm text-white/90">{summary.short_note}</p>
        )}
        <div className="mt-3 flex items-center gap-3">
          <span className="inline-block rounded-full bg-white/20 px-3 py-0.5 text-xs font-medium">
            {(plan.plan_mode && MODE_LABELS[plan.plan_mode]) ??
              INTENSITY_LABELS[intensity] ??
              "Balanced day"}
          </span>
          <Link
            href="/check-in"
            className="text-xs text-white/80 underline underline-offset-2 hover:text-white"
          >
            Check in again
          </Link>
        </div>
      </div>

      {message && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl bg-[#EEF2FF] px-4 py-3 text-sm text-[#1F2937]"
        >
          {message}
        </div>
      )}

      {/* MW-V10-03: stale view — the server has a newer plan than this page. */}
      {staleView && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#EDE9FE] px-4 py-3 text-sm text-[#1F2937]"
        >
          <span>{staleView}</span>
          <button
            onClick={() => {
              setStaleView(null);
              router.refresh();
            }}
            className="inline-flex min-h-[44px] shrink-0 items-center rounded-xl border border-[#7C9A92]/40 px-4 text-xs font-medium text-[#6D8C7D] transition hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C9A92] focus-visible:ring-offset-2"
          >
            Reload today
          </button>
        </div>
      )}

      {/* MW-V9-03: brief undo for the item just marked Done from the Now card. */}
      {justDone && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-between gap-2 rounded-xl border border-[#92400E]/20 bg-[#FEF3C7] px-4 py-2.5 text-sm text-[#92400E]"
        >
          <span>Marked done.</span>
          <button
            onClick={() => {
              toggleDone(justDone, "now");
              setJustDone(null);
            }}
            className="inline-flex min-h-[44px] shrink-0 items-center px-2 font-medium underline underline-offset-2 hover:text-[#78350F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#92400E] focus-visible:ring-offset-2"
          >
            Undo
          </button>
        </div>
      )}

      {/* MW-S01: Now — one next useful action from the saved plan. */}
      {nowSelection.action ? (
        <div className="rounded-2xl border border-[#E5E1DA] bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-[#9CA3AF]">
            Now · one next step
          </p>
          <div aria-live="polite">
            <h2 className="mt-1 text-lg font-semibold text-[#1F2937]">
              {nowSelection.action.title}
            </h2>
            <p className="mt-0.5 text-sm text-[#6B7280]">
              {nowSelection.action.reason}
              {typeof nowSelection.action.durationMinutes === "number" && (
                <span className="text-[#9CA3AF]">
                  {" "}
                  · about {nowSelection.action.durationMinutes} min
                </span>
              )}
            </p>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              // MW-V10-03: no local success claim — toggleDone sets the
              // confirmation only once the server has stored the completion.
              onClick={() => toggleDone(nowSelection.action!.key, "now")}
              disabled={savingKeys.has(nowSelection.action.key)}
              aria-busy={savingKeys.has(nowSelection.action.key)}
              className={buttonClass("primary")}
            >
              {savingKeys.has(nowSelection.action.key) && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              Done
            </button>
            <button
              onClick={() => setDeferOpen((v) => !v)}
              disabled={savingKeys.has(nowSelection.action.key)}
              aria-expanded={deferOpen}
              className={buttonClass("secondary")}
            >
              Not now
            </button>
            <button
              onClick={() => setShowFull((v) => !v)}
              className={buttonClass("quiet", "text-[#7C9A92] underline underline-offset-2 hover:text-[#6D8C7D]")}
            >
              {showFull ? "Hide full plan" : "View full plan"}
            </button>
          </div>
          {deferOpen && (
            <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Why not now?">
              {(
                [
                  ["no_time", "No time right now"],
                  ["too_much", "Too much right now"],
                  ["not_relevant", "Not relevant today"],
                  ["already_handled", "Already handled"],
                ] as const
              ).map(([code, label]) => (
                <button
                  key={code}
                  onClick={() => deferNow(nowSelection.action!, code)}
                  // MW-V10-07: 44px minimum. These sat at ~30px on the most
                  // frequently tapped screen in the product.
                  className="inline-flex min-h-[44px] items-center rounded-full border border-[#E5E1DA] px-4 text-xs text-[#6B7280] transition hover:border-[#7C9A92]/50 hover:text-[#1F2937] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C9A92] focus-visible:ring-offset-2"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-[#9CA3AF]">
            One step at a time is enough. The full plan is always here.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-[#E5E1DA] bg-white p-5 shadow-sm" aria-live="polite">
          <p className="text-xs font-medium uppercase tracking-wide text-[#9CA3AF]">
            Now
          </p>
          <p className="mt-1 text-sm text-[#1F2937]">
            {nowSelection.allDone
              ? "That's everything from today's plan. Nothing else is asked of you."
              : "Nothing pressing right now. The full plan is below if you want it."}
          </p>
        </div>
      )}

      {(showFull || !nowSelection.action) && (<>
      {/* 2. Meal cards */}
      <div className="space-y-3">
        <h2 className="px-1 text-sm font-medium uppercase tracking-wide text-[#9CA3AF]">
          Meals that fit today
        </h2>
        {meals.length === 0 && (
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <p className="text-sm text-[#6B7280]">
              Because you told us about a severe or life-threatening allergy,
              Mellowa doesn&apos;t suggest specific meals or recipes — automated
              checks can&apos;t guarantee ingredient, label or
              cross-contamination safety at that level. A registered dietitian or
              allergy specialist can help you build a safe meal routine. The rest
              of today&apos;s plan is below.
            </p>
          </div>
        )}
        {meals.map((meal, mealIndex) => (
          <div
            key={`${meal.meal_type}-${mealIndex}`}
            className="rounded-2xl bg-white p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-[#7C9A92]">
                  {meal.meal_type}
                </p>
                <h3 className="mt-0.5 font-medium text-[#1F2937]">{meal.title}</h3>
                {meal.short_description && (
                  <p className="mt-0.5 text-sm text-[#6B7280]">
                    {meal.short_description}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span className="rounded-full bg-[#FAF7F2] px-2.5 py-0.5 text-xs text-[#6B7280]">
                  {meal.total_time_minutes} min · {meal.difficulty}
                </span>
                <SaveMealButton meal={meal} />
              </div>
            </div>

            {macrosVisible && (
              <div className="flex items-center gap-2">
                <MacroPills macros={meal.approximate_macros} />
                <button
                  onClick={hideMacros}
                  className="text-xs text-[#9CA3AF] underline hover:text-[#6B7280]"
                >
                  Hide
                </button>
              </div>
            )}

            <details className="group mt-3">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-[#7C9A92]">
                <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
                See ingredients
              </summary>
              <div className="mt-2 space-y-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-[#9CA3AF]">
                    Ingredients
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {meal.ingredients.map((ing, i) => (
                      <li key={i} className="text-sm text-[#1F2937]">
                        {ing.amount ? `${ing.amount} ` : ""}
                        {ing.name}
                        {ing.optional && (
                          <span className="text-[#9CA3AF]"> (optional)</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-[#9CA3AF]">
                    Steps
                  </p>
                  <ol className="mt-1 space-y-1">
                    {meal.preparation_steps.map((s, i) => (
                      <li key={i} className="flex gap-2 text-sm text-[#1F2937]">
                        <span className="text-[#9CA3AF]">{i + 1}.</span>
                        {s}
                      </li>
                    ))}
                  </ol>
                </div>
                {meal.low_energy_swap && (
                  <p className="text-xs text-[#6B7280]">
                    <span className="font-medium">If today gets smaller:</span>{" "}
                    {meal.low_energy_swap}
                  </p>
                )}
                <p className="text-xs text-[#9CA3AF]">{meal.safety_note}</p>
              </div>
            </details>

            <div className="mt-3 flex gap-1.5">
              <button
                onClick={() => regenerateMeal(meal.meal_type, "different_meals")}
                disabled={busy === `meal:${meal.meal_type}` || simplifying}
                className="flex items-center gap-1 rounded-lg border border-[#E5E1DA] px-2.5 py-1.5 text-xs text-[#6B7280] transition hover:border-[#7C9A92]/50 hover:text-[#1F2937] disabled:opacity-50"
              >
                {busy === `meal:${meal.meal_type}` ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                Swap this meal
              </button>
              <button
                onClick={() => regenerateMeal(meal.meal_type, "simplify")}
                disabled={busy === `meal:${meal.meal_type}` || simplifying}
                className="flex items-center gap-1 rounded-lg border border-[#E5E1DA] px-2.5 py-1.5 text-xs text-[#6B7280] transition hover:border-[#7C9A92]/50 hover:text-[#1F2937] disabled:opacity-50"
              >
                <Feather className="h-3 w-3" />
                Make it easier
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 3. Hydration */}
      {plan.hydration_plan_v2 && (
        <Section
          icon={<Droplets className="h-4 w-4 text-[#7C9A92]" />}
          title="A simple water cue"
        >
          <p className="mt-1 text-sm text-[#1F2937]">{plan.hydration_plan_v2.goal}</p>
          <ul className="mt-2 space-y-1">
            {plan.hydration_plan_v2.timing.map((t, i) => (
              <li key={i} className="text-sm text-[#6B7280]">
                • {t}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* 4. Movement */}
      {movement && (
        <Section
          icon={<Footprints className="h-4 w-4 text-[#7C9A92]" />}
          title="If movement feels useful"
          action={
            <button
              onClick={regenerateMovement}
              disabled={busy === "movement" || simplifying}
              className="flex items-center gap-1 rounded-lg border border-[#E5E1DA] px-2.5 py-1.5 text-xs text-[#6B7280] transition hover:border-[#7C9A92]/50 hover:text-[#1F2937] disabled:opacity-50"
            >
              {busy === "movement" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Feather className="h-3 w-3" />
              )}
              Make it easier
            </button>
          }
        >
          <p className="mt-1 text-sm font-medium text-[#1F2937]">
            {movement.title}
            <span className="ml-2 font-normal text-[#9CA3AF]">
              {movement.duration_minutes} min · {movement.intensity.replace(/_/g, " ")}
            </span>
          </p>
          <ol className="mt-2 space-y-1">
            {movement.steps.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm text-[#1F2937]">
                <span className="text-[#9CA3AF]">{i + 1}.</span>
                {s}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-[#9CA3AF]">{movement.caution_note}</p>
          <DoneToggle
            done={!!doneItems.movement}
            onClick={() => toggleDone("movement")}
          />
        </Section>
      )}

      {/* 5. One calm reset (Prompt 11) — a single option, never all three */}
      {calmReset && (
        <h2 className="px-1 text-sm font-medium uppercase tracking-wide text-[#9CA3AF]">
          One pause for today
        </h2>
      )}
      {calmReset === "breathing" && plan.breathing_exercise && (
        <Section
          icon={<Wind className="h-4 w-4 text-[#7C9A92]" />}
          title={sectionName(plan.breathing_exercise.name, "A breathing pause")}
        >
          <p className="mt-0.5 text-xs text-[#9CA3AF]">
            {plan.breathing_exercise.duration_minutes} min ·{" "}
            {plan.breathing_exercise.when_to_use}
          </p>
          <ol className="mt-2 space-y-1">
            {plan.breathing_exercise.steps.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm text-[#1F2937]">
                <span className="text-[#9CA3AF]">{i + 1}.</span>
                {s}
              </li>
            ))}
          </ol>
          {plan.breathing_exercise.gentle_note && (
            <p className="mt-2 text-xs text-[#9CA3AF]">
              {plan.breathing_exercise.gentle_note}
            </p>
          )}
          <DoneToggle
            done={!!doneItems.breathing}
            onClick={() => toggleDone("breathing")}
          />
        </Section>
      )}
      {calmReset === "meditation" && plan.meditation_or_reflection && (
        <Section
          icon={<Brain className="h-4 w-4 text-[#7C9A92]" />}
          title={sectionName(plan.meditation_or_reflection.name, "A short reflection")}
        >
          <p className="mt-0.5 text-xs text-[#9CA3AF]">
            {plan.meditation_or_reflection.duration_minutes} min
          </p>
          <div className="mt-2 space-y-1">
            {plan.meditation_or_reflection.script.map((s, i) => (
              <p key={i} className="text-sm italic text-[#1F2937]">
                {s}
              </p>
            ))}
          </div>
          {plan.meditation_or_reflection.journal_prompt && (
            <p className="mt-2 rounded-xl bg-[#EDE9FE]/50 px-3 py-2 text-sm text-[#1F2937]">
              {plan.meditation_or_reflection.journal_prompt}
            </p>
          )}
        </Section>
      )}
      {calmReset === "relaxation" && plan.relaxation_technique && (
        <Section
          icon={<Sparkles className="h-4 w-4 text-[#7C9A92]" />}
          title={sectionName(plan.relaxation_technique.name, "A relaxation pause")}
        >
          <p className="mt-0.5 text-xs text-[#9CA3AF]">
            {plan.relaxation_technique.duration_minutes} min ·{" "}
            {plan.relaxation_technique.best_for}
          </p>
          <ol className="mt-2 space-y-1">
            {plan.relaxation_technique.steps.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm text-[#1F2937]">
                <span className="text-[#9CA3AF]">{i + 1}.</span>
                {s}
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* 6. Focus block — hidden on lighter days (Prompt 11) */}
      {showFocus && plan.focus_plan && (
        <Section
          icon={<Target className="h-4 w-4 text-[#7C9A92]" />}
          title="One thing to protect"
        >
          <p className="mt-1 text-sm text-[#1F2937]">{plan.focus_plan.main_task}</p>
          {plan.focus_plan.method && (
            <p className="mt-1 text-sm text-[#6B7280]">{plan.focus_plan.method}</p>
          )}
          {plan.focus_plan.break_reminder && (
            <p className="mt-1 text-xs text-[#9CA3AF]">
              {plan.focus_plan.break_reminder}
            </p>
          )}
        </Section>
      )}

      {/* 7. Evening wind-down */}
      {plan.evening_routine && (
        <Section
          icon={<Moon className="h-4 w-4 text-[#7C9A92]" />}
          title="A softer landing"
        >
          {plan.evening_routine.time && (
            <p className="mt-0.5 text-xs text-[#9CA3AF]">
              {plan.evening_routine.time}
            </p>
          )}
          <ul className="mt-2 space-y-1">
            {plan.evening_routine.steps.map((s, i) => (
              <li key={i} className="text-sm text-[#1F2937]">
                • {s}
              </li>
            ))}
          </ul>
          {plan.evening_routine.simple_version && (
            <p className="mt-2 text-xs text-[#6B7280]">
              <span className="font-medium">If today gets smaller:</span>{" "}
              {plan.evening_routine.simple_version}
            </p>
          )}
        </Section>
      )}

      {/* 8. One small habit */}
      {plan.habit_focus && (
        <Section
          icon={<Check className="h-4 w-4 text-[#7C9A92]" />}
          title="One repeatable step"
        >
          <p className="mt-1 text-sm text-[#1F2937]">{plan.habit_focus.habit}</p>
          {plan.habit_focus.minimum_version && (
            <p className="mt-1 text-sm text-[#6B7280]">
              If today gets smaller: {plan.habit_focus.minimum_version}
            </p>
          )}
          <DoneToggle
            done={!!doneItems.habit}
            onClick={() => toggleDone("habit")}
          />
        </Section>
      )}

      {/* Encouragement + safety */}
      {plan.encouragement && (
        <div className="rounded-2xl bg-[#EDE9FE]/60 p-5 text-sm text-[#1F2937]">
          {plan.encouragement}
        </div>
      )}
      {plan.safety_note && (
        <p className="px-2 text-xs text-[#9CA3AF]">{plan.safety_note}</p>
      )}
      <p className="px-2 text-center text-sm text-[#6B7280]">
        Use the structure that helps. Leave the rest.
      </p>

      {/* Gentle feedback (Prompt 10) */}
      <PlanFeedback planId={plan.id} />

      </>)}

      {/* MW-S02/MW-V9-04: after a committed repair — deterministic diff + free Undo */}
      {repairResult && (
        <div className="rounded-2xl border border-[#92400E]/20 bg-[#FEF3C7] p-5 text-sm text-[#1F2937]" aria-live="polite">
          <p className="font-medium">Rest of today adjusted</p>
          <p className="mt-1">
            {deterministicDiff(repairResult.changed)}
            {" Kept as they were: "}
            {repairResult.keptCount} kept item{repairResult.keptCount === 1 ? "" : "s"} and{" "}
            {repairResult.completedCount} already-done item
            {repairResult.completedCount === 1 ? "" : "s"} — untouched.
          </p>
          <p className="mt-1 text-xs text-[#6B7280]">{repairResult.summary}</p>
          <button
            onClick={undoRepair}
            disabled={simplifying}
            className="mt-3 rounded-xl border border-[#92400E]/30 px-3.5 py-1.5 text-xs font-medium text-[#92400E] transition hover:bg-white/60 disabled:opacity-60"
          >
            Undo — bring the previous plan back
          </button>
        </div>
      )}

      {/* MW-S02: atomic repair sheet */}
      {repairOpen ? (
        <div className="rounded-2xl border border-[#E5E1DA] bg-white p-5 shadow-sm">
          <h2 className="font-medium text-[#1F2937]">Adjust the rest of today</h2>
          <p className="mt-1 text-sm text-[#6B7280]">
            One pass replaces only what&apos;s still open. Anything marked done
            or kept stays exactly as it is.
          </p>
          <p className="mt-2 text-xs font-medium uppercase tracking-wide text-[#9CA3AF]">
            What changed?
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {(
              [
                ["less_time", "Less time"],
                ["lower_energy", "Lower energy"],
                ["context_changed", "Different context"],
                // No meal section for severe-allergy plans, so hide the meal reason.
                ...(meals.length > 0
                  ? [["meal_not_working", "Meals don't work"]]
                  : []),
                ["calmer_version", "Need a calmer version"],
              ] as [string, string][]
            ).map(([code, label]) => (
              <button
                key={code}
                onClick={() => setRepairReason(code)}
                aria-pressed={repairReason === code}
                className={clsx(
                  "inline-flex min-h-[44px] items-center rounded-full border px-4 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C9A92] focus-visible:ring-offset-2",
                  repairReason === code
                    ? "border-[#7C9A92] bg-[#7C9A92]/10 text-[#1F2937]"
                    : "border-[#E5E1DA] text-[#6B7280] hover:border-[#7C9A92]/50"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-[#9CA3AF]">
            What will change
          </p>
          <p className="mt-1 text-xs text-[#6B7280]">
            Can change: {planItems.filter((i) => !doneItems[i.key] && !keptKeys.has(i.key)).length}{" "}
            · Kept: {planItems.filter((i) => !doneItems[i.key] && keptKeys.has(i.key)).length} ·
            Already done: {planItems.filter((i) => !!doneItems[i.key]).length}
          </p>
          <ul className="mt-1.5 space-y-1">
            {planItems.map((item) => {
              const isDone = !!doneItems[item.key];
              const isKept = keptKeys.has(item.key);
              return (
                <li key={item.key} className="flex items-center justify-between gap-2 text-sm">
                  <span className={clsx(isDone || isKept ? "text-[#9CA3AF]" : "text-[#1F2937]")}>
                    {item.label}
                  </span>
                  {isDone ? (
                    <span className="rounded-full bg-[#FEF3C7] px-2.5 py-0.5 text-xs text-[#92400E]">
                      Already done — kept
                    </span>
                  ) : (
                    <button
                      onClick={() =>
                        setKeptKeys((prev) => {
                          const next = new Set(prev);
                          if (next.has(item.key)) next.delete(item.key);
                          else next.add(item.key);
                          return next;
                        })
                      }
                      aria-pressed={isKept}
                      className={clsx(
                        // MW-V10-07: this "Keep this" toggle was ~20px tall —
                        // the smallest interactive target in the app, on the
                        // control that decides what a repair may overwrite.
                        "inline-flex min-h-[44px] shrink-0 items-center rounded-full border px-3 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C9A92] focus-visible:ring-offset-2",
                        isKept
                          ? "border-[#7C9A92] bg-[#7C9A92]/10 text-[#1F2937]"
                          : "border-[#E5E1DA] text-[#6B7280] hover:border-[#7C9A92]/50"
                      )}
                    >
                      {isKept ? "Kept — won't change" : "Keep this"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <label className="mt-3 block text-xs font-medium uppercase tracking-wide text-[#9CA3AF]">
            Anything else? (optional)
            <textarea
              value={repairNote}
              onChange={(e) => setRepairNote(e.target.value)}
              maxLength={1000}
              rows={2}
              className="mt-1 w-full rounded-xl border border-[#E5E1DA] px-3 py-2 text-sm font-normal normal-case tracking-normal text-[#1F2937] focus:border-[#7C9A92] focus:outline-none"
              placeholder="Used for this adjustment only — not saved or remembered."
            />
          </label>
          <p className="mt-2 text-xs text-[#9CA3AF]">
            Uses one plan generation from your fair-use allowance. Undo is free.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={submitRepair}
              disabled={simplifying || !repairReason}
              className="flex items-center gap-2 rounded-xl bg-[#7C9A92] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#6D8C7D] disabled:opacity-60"
            >
              {simplifying ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Adjusting the rest of today…
                </>
              ) : (
                "Adjust the rest of today"
              )}
            </button>
            <button
              onClick={() => setRepairOpen(false)}
              disabled={simplifying}
              className="rounded-xl border border-[#E5E1DA] px-4 py-2 text-sm text-[#6B7280] transition hover:border-[#7C9A92]/50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : isPremium ? (
        <button
          onClick={() => setRepairOpen(true)}
          disabled={simplifying}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[#E5E1DA] bg-white px-4 py-3 text-sm text-[#6B7280] transition hover:border-[#7C9A92]/50 hover:text-[#1F2937] disabled:opacity-60"
        >
          <Feather className="h-4 w-4" />
          Adjust the rest of today
        </button>
      ) : (
        // Whole-day adjust is Premium-only. Show the prompt up front rather than
        // letting a free/sample user fill in the sheet and commit into a 402.
        <div className="rounded-2xl border border-[#E5E1DA] bg-white px-4 py-4">
          <div className="flex items-center gap-2">
            <Feather className="h-4 w-4 text-[#7C9A92]" />
            <p className="text-sm font-medium text-[#1F2937]">
              Adjust the whole day — a Premium feature
            </p>
          </div>
          <p className="mt-1.5 text-sm text-[#6B7280]">
            {entitlementMessage("premium_required")}
          </p>
          <Link
            href="/billing"
            onClick={() =>
              trackClient("premium_value_explained", { surface: "today" })
            }
            className="mt-3 inline-flex items-center justify-center rounded-xl bg-[#7C9A92] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#6D8C7D]"
          >
            See Premium plans
          </Link>
        </div>
      )}
    </div>
  );
}

function DoneToggle({ done, onClick }: { done: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "mt-3 flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-medium transition",
        done
          ? "bg-[#FEF3C7] text-[#92400E]"
          : "bg-[#7C9A92] text-white hover:bg-[#6D8C7D]"
      )}
    >
      <Check className="h-3.5 w-3.5" />
      {done ? "Undo" : "Done for now"}
    </button>
  );
}
