import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";
import {
  FavouritesView,
  type FavouriteMeal,
} from "@/components/dailyflow/favourites-view";

export const metadata: Metadata = { title: "Favourites — Mellowa" };

export default async function FavouritesPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data } = await supabase
    .from("favourite_meals")
    .select("id, title, meal_type, meal")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const meals = (data ?? []) as FavouriteMeal[];

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[#1F2937]">
          Saved meals
        </h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          Your favourite meals, ready to reuse — and to turn into a shopping list.
        </p>
      </div>
      <FavouritesView initial={meals} />
    </div>
  );
}
