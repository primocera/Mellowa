import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { MealCardSchema } from "@/schemas/ai-output-v2";

const Input = z.object({
  action: z.enum(["save", "unsave"]),
  meal: MealCardSchema,
});

function signature(title: string, mealType: string): string {
  return `${title.trim().toLowerCase()}|${mealType}`;
}

/**
 * Save or remove a meal from the user's favourites (Prompt 6). The full meal
 * card is stored so it can be reused later without another provider call.
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
  const { action, meal } = parsed.data;
  const sig = signature(meal.title, meal.meal_type);

  if (action === "unsave") {
    const { error } = await supabase
      .from("favourite_meals")
      .delete()
      .eq("user_id", user.id)
      .eq("meal_signature", sig);
    if (error) {
      return NextResponse.json({ error: "Failed to remove" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, saved: false });
  }

  // Upsert so re-saving the same meal is idempotent.
  const { error } = await supabase.from("favourite_meals").upsert(
    {
      user_id: user.id,
      meal_signature: sig,
      meal_type: meal.meal_type,
      title: meal.title,
      meal,
    },
    { onConflict: "user_id,meal_signature" }
  );
  if (error) {
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, saved: true });
}
