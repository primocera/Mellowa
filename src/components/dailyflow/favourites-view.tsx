"use client";

import { useState } from "react";
import { Loader2, ShoppingCart, Check, Trash2, Minus, Plus } from "lucide-react";
import clsx from "clsx";
import type { MealCardType } from "@/schemas/ai-output-v2";
import type { ShoppingCategory } from "@/lib/shopping/aggregate";
import { formatItem } from "@/lib/shopping/aggregate";
import { errorCopy } from "@/lib/microcopy/errors";

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
  const [categories, setCategories] = useState<ShoppingCategory[] | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Prompt 13: servings multiplier and a check-off ("have it") set so a
  // pantry item can be ticked without disappearing.
  const [servings, setServings] = useState(1);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const chosenIds = Object.keys(selected).filter((id) => selected[id]);

  function toggle(id: string) {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
    setCategories(null);
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
    setChecked({});
    try {
      const res = await fetch("/api/shopping/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meal_ids: chosenIds, servings_scale: servings }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error("failed");
      setCategories((data.categories as ShoppingCategory[]) ?? []);
      setExcluded((data.excluded_meals as string[]) ?? []);
    } catch {
      setError(errorCopy("generic"));
    }
    setBuilding(false);
  }

  if (meals.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="font-medium text-[#1F2937]">
          Nothing saved yet—and nothing to organize.
        </h2>
        <p className="mt-1 text-sm text-[#6B7280]">
          Save a meal from Today when it genuinely feels reusable.
        </p>
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

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-[#6B7280]">Servings</span>
          <div className="flex items-center gap-1 rounded-xl border border-[#E5E1DA] bg-white p-1">
            <button
              type="button"
              onClick={() => setServings((s) => Math.max(1, s - 1))}
              disabled={servings <= 1}
              aria-label="Fewer servings"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[#6B7280] transition hover:bg-[#FAF7F2] disabled:opacity-40"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-6 text-center text-sm font-medium text-[#1F2937]">
              {servings}×
            </span>
            <button
              type="button"
              onClick={() => setServings((s) => Math.min(8, s + 1))}
              disabled={servings >= 8}
              aria-label="More servings"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[#6B7280] transition hover:bg-[#FAF7F2] disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
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
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl bg-[#FEE2E2] px-4 py-3 text-sm text-[#991B1B]"
        >
          {error}
        </div>
      )}

      {categories && (
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="font-medium text-[#1F2937]">Your shopping list</h2>
          {excluded.length > 0 && (
            <p className="mt-2 rounded-xl bg-[#FEF3C7] px-3 py-2 text-xs text-[#92400E]">
              Skipped {excluded.join(", ")} — these saved meals may conflict
              with your current allergy list.
            </p>
          )}
          {categories.length === 0 ? (
            <p className="mt-2 text-sm text-[#6B7280]">
              These meals had no grocery items listed.
            </p>
          ) : (
            <div className="mt-3 space-y-4">
              {categories.map((group) => (
                <div key={group.category}>
                  <p className="text-xs font-medium uppercase tracking-wide text-[#9CA3AF]">
                    {group.category}
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {group.items.map((item) => {
                      const key = `${item.category}:${item.name}:${item.unit ?? ""}`;
                      const isChecked = !!checked[key];
                      return (
                        <li key={key}>
                          <label className="flex min-h-[44px] cursor-pointer items-start gap-2.5 text-sm">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() =>
                                setChecked((c) => ({ ...c, [key]: !c[key] }))
                              }
                              className="mt-1 h-4 w-4 shrink-0 rounded border-[#D8D3CA] accent-[#7C9A92]"
                            />
                            <span
                              className={clsx(
                                "flex-1",
                                isChecked
                                  ? "text-[#9CA3AF] line-through"
                                  : "text-[#1F2937]"
                              )}
                            >
                              {formatItem(item)}
                              {item.notes.length > 0 && (
                                <span className="text-[#9CA3AF]">
                                  {" "}
                                  · {item.notes.join(", ")}
                                </span>
                              )}
                              <span className="block text-xs text-[#9CA3AF]">
                                for {item.sources.join(", ")}
                              </span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-[#6B7280]">
            Meals are checked against your listed allergies, but Mellowa cannot
            guarantee allergy safety — always verify product labels, especially
            for severe allergies or cross-contamination risks.
          </p>
        </div>
      )}
    </div>
  );
}
