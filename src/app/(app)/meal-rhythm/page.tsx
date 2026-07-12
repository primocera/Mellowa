import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";
import { MealRhythmView } from "@/components/dailyflow/meal-rhythm-view";

export const metadata: Metadata = { title: "Meal rhythm — Mellowa" };

type MealRhythm = Parameters<typeof MealRhythmView>[0]["initial"];

export default async function MealRhythmPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: latest } = await supabase
    .from("meal_ideas")
    .select("idea")
    .eq("user_id", user.id)
    .eq("meal_type", "meal_rhythm_set")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-[#1F2937]">
          Meal rhythm
        </h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          Simple structure, not a strict diet — formulas you can repeat on
          autopilot.
        </p>
      </div>
      <MealRhythmView initial={(latest?.idea as MealRhythm) ?? null} />
    </div>
  );
}
