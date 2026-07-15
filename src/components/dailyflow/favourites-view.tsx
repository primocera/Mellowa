"use client";

import { useState } from "react";
import { Loader2, ShoppingCart, Check, Trash2 } from "lucide-react";
import clsx from "clsx";
import type { MealCardType } from "@/schemas/ai-output-v2";

export type FavouriteMeal = {
  id: string;
  title: string;
  meal_type: string;
  meal: MealCardType;
};

/**
 * Favourites (Prompt 6): browse saved meals, pick some, and build a merged
 * shopping list from their grocery items.
 */
export function FavouritesView({ initial }: { initial: FavouriteMeal[] }) {
  const [meals, setMeals] = useState(initial);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [building, setBuilding] = useState(false);
  const [list, setList] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chosenIds = Object.keys(selected).filter((id) => selected[id]);

  function toggle(id: string) {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
    setList(null);
  }

  async function remove(id: string) {
    const meal = meals.find((m) => m.id === id);
    if (!meal) return;
    setMeals((prev) => prev.filter((m) => m.id !== id));
    try {
      await fetch("/api/meals/favourite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unsave", meal: meal.meal }),
      });
    } catch {
      // best effort — restore on failure
      setMeals((prev) => [meal, ...prev]);
    }
  }

  async function buildList() {
    setBuilding(true);
    setError(null);
    try {
      const res = await fetch("/api/shopping/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meal_ids: chosenIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error("failed");
      setList(data.items as string[]);
    } catch {
      setError("Couldn't build the shopping list. Please try again.");
    }
    setBuilding(false);
  }

  if (meals.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-6 text-sm text-[#6B7280] shadow-sm">
        No saved meals yet. Tap the heart on any meal in your daily plan to save
        it here for quick reuse.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {meals.map((m) => (
          <div
            key={m.id}
            className="flex items-start gap-3 rounded-2xl bg-white p-4 shadow-sm"
          >
            <button
              type="button"
              onClick={() => toggle(m.id)}
              aria-pressed={!!selected[m.id]}
              className={clsx(
                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition",
                selected[m.id]
                  ? "border-[#7C9A92] bg-[#7C9A92] text-white"
                  : "border-[#D8D3CA] bg-white"
              )}
            >
              {selected[m.id] && <Check className="h-3.5 w-3.5" />}
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase tracking-wide text-[#7C9A92]">
                {m.meal_type}
              </p>
              <p className="font-medium text-[#1F2937]">{m.title}</p>
              {m.meal.short_description && (
                <p className="mt-0.5 text-sm text-[#6B7280]">
                  {m.meal.short_description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => remove(m.id)}
              aria-label="Remove from favourites"
              className="shrink-0 rounded-full p-1.5 text-[#9CA3AF] transition hover:bg-[#FAF7F2] hover:text-[#991B1B]"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={buildList}
        disabled={chosenIds.length === 0 || building}
        className="flex items-center gap-2 rounded-xl bg-[#7C9A92] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#6D8C7D] disabled:opacity-50"
      >
        {building ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ShoppingCart className="h-4 w-4" />
        )}
        Build shopping list ({chosenIds.length})
      </button>

      {error && (
        <div className="rounded-xl bg-[#FEE2E2] px-4 py-3 text-sm text-[#991B1B]">
          {error}
        </div>
      )}

      {list && (
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="font-medium text-[#1F2937]">Your shopping list</h2>
          {list.length === 0 ? (
            <p className="mt-2 text-sm text-[#6B7280]">
              These meals had no grocery items listed.
            </p>
          ) : (
            <ul className="mt-3 space-y-1">
              {list.map((item, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-[#1F2937]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#7C9A92]" />
                  {item}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
