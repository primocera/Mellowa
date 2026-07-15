import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { MealCardSchema } from "@/schemas/ai-output-v2";

const Input = z.object({
  meal_ids: z.array(z.string().uuid()).min(1).max(30),
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

  // Merge grocery items, keeping first-seen casing, de-duped by lowercase.
  const seen = new Map<string, string>();
  for (const row of rows ?? []) {
    const meal = MealCardSchema.safeParse(row.meal);
    if (!meal.success) continue;
    for (const item of meal.data.grocery_items) {
      const key = item.trim().toLowerCase();
      if (key && !seen.has(key)) seen.set(key, item.trim());
    }
  }
  const items = [...seen.values()].sort((a, b) => a.localeCompare(b));

  const { data: saved, error: saveError } = await supabase
    .from("shopping_lists")
    .insert({ user_id: user.id, items })
    .select()
    .single();
  if (saveError) {
    return NextResponse.json({ error: "Failed to save list" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, list: saved, items });
}
