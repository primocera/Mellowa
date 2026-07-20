import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { MealCardSchema } from "@/schemas/ai-output-v2";
import { findMealAllergenViolations } from "@/lib/safety/allergens";
import { aggregateShopping, formatItem } from "@/lib/shopping/aggregate";
import { trackEvent } from "@/lib/analytics";

const Input = z.object({
  meal_ids: z.array(z.string().uuid()).min(1).max(30),
  // Prompt 13: optional servings multiplier, safely bounded.
  servings_scale: z.number().min(0.25).max(8).optional(),
});

/**
 * Build a shopping list (Prompt 6) by merging the grocery_items of the chosen
 * saved meals, de-duplicated case-insensitively. Persists a shopping_lists row
 * and returns the merged items.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = Input.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { data: rows, error } = await supabase
    .from("favourite_meals")
    .select("meal")
    .eq("user_id", user.id)
    .in("id", parsed.data.meal_ids);
  if (error) {
    return NextResponse.json({ error: "Failed to read meals" }, { status: 500 });
  }

  // Allergen re-validation when building a list (Prompt 8): favourites saved
  // before an allergy list changed must not flow into shopping items.
  const { data: profile } = await supabase
    .from("wellbeing_profiles")
    .select("allergies, pantry_items")
    .eq("user_id", user.id)
    .maybeSingle();
  const allergies = (profile?.allergies ?? []).filter(Boolean);
  // MW-S05: persistent pantry — items the user marked as already on hand are
  // taken off the draft and listed separately (never silently dropped).
  const pantry = ((profile?.pantry_items as string[] | null) ?? [])
    .map((s) => String(s).trim().toLowerCase())
    .filter(Boolean);

  // Collect safe meals, then aggregate: merge unit-compatible lines, group by
  // category, keep recipe traceability and scale by servings (Prompt 13).
  const safeMeals: { title: string; grocery_items: string[] }[] = [];
  const excludedMeals: string[] = [];
  for (const row of rows ?? []) {
    const meal = MealCardSchema.safeParse(row.meal);
    if (!meal.success) continue;
    if (
      allergies.length &&
      findMealAllergenViolations(meal.data, allergies).length > 0
    ) {
      excludedMeals.push(meal.data.title);
      continue;
    }
    safeMeals.push({
      title: meal.data.title,
      grocery_items: meal.data.grocery_items,
    });
  }

  const allCategories = aggregateShopping(
    safeMeals,
    parsed.data.servings_scale ?? 1
  );
  const onHand: string[] = [];
  const categories = allCategories
    .map((c) => ({
      ...c,
      items: c.items.filter((it) => {
        const isOnHand = pantry.some((p) => it.name.toLowerCase() === p);
        if (isOnHand) onHand.push(formatItem(it));
        return !isOnHand;
      }),
    }))
    .filter((c) => c.items.length > 0);
  // Flat, sorted string list kept for backward compatibility + persistence.
  const items = categories
    .flatMap((c) => c.items.map(formatItem))
    .sort((a, b) => a.localeCompare(b));

  const { data: saved, error: saveError } = await supabase
    .from("shopping_lists")
    .insert({ user_id: user.id, items })
    .select()
    .single();
  if (saveError) {
    return NextResponse.json({ error: "Failed to save list" }, { status: 500 });
  }

  trackEvent("shopping_draft_built", {
    userId: user.id,
    properties: { surface: "week" },
  });

  return NextResponse.json({
    ok: true,
    list: saved,
    items,
    // Grouped, traceable view for the UI.
    categories,
    // Surfaced in the UI so exclusions are never silent.
    excluded_meals: excludedMeals,
    // Pantry items left off the draft — shown, not silently dropped.
    on_hand: onHand,
  });
}
