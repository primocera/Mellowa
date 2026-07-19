import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { trackEvent } from "@/lib/analytics";

/**
 * MW-S04: user-owned routine presets. Presets hold PRACTICAL, bounded
 * check-in context only — never energy/stress, notes, health context or any
 * inferred state. The user-chosen name is stored for the user's own list and
 * is never sent to AI prompts or analytics (only the categorical context type
 * is tracked). Applying a preset happens client-side as a visible prefill, so
 * generation always goes through today's explicit check-in and its safety
 * classification — a preset cannot bypass either.
 */

const MAX_PRESETS = 6;

const PresetInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(40),
  context: z
    .enum(["busy", "low_capacity", "out_of_routine", "home", "on_the_go", "social"])
    .nullable()
    .optional(),
  time_available: z
    .enum([
      "Almost none",
      "About 10 minutes",
      "About 20 minutes",
      "About 30 minutes",
      "Flexible today",
    ])
    .nullable()
    .optional(),
  mode: z.enum(["auto", "minimum", "reset", "balanced", "custom"]).default("auto"),
  areas: z
    .array(z.enum(["food", "energy", "calm", "movement", "sleep"]))
    .max(5)
    .default([]),
  weekday_default: z.number().int().min(0).max(6).nullable().optional(),
});

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabase
    .from("routine_presets")
    .select("id, name, context, time_available, mode, areas, weekday_default")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  return NextResponse.json({ presets: data ?? [] });
}

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
  const parsed = PresetInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { id, name, context, time_available, mode, areas, weekday_default } =
    parsed.data;

  if (!id) {
    const { count } = await supabase
      .from("routine_presets")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);
    if ((count ?? 0) >= MAX_PRESETS) {
      return NextResponse.json(
        {
          error: "preset_limit",
          user_message: `You can keep up to ${MAX_PRESETS} presets — remove one to add another.`,
        },
        { status: 400 }
      );
    }
  }

  const row = {
    user_id: user.id,
    name,
    context: context ?? null,
    time_available: time_available ?? null,
    mode,
    areas,
    weekday_default: weekday_default ?? null,
    updated_at: new Date().toISOString(),
  };

  const query = id
    ? supabase
        .from("routine_presets")
        .update(row)
        .eq("id", id)
        .eq("user_id", user.id)
        .select("id")
        .maybeSingle()
    : supabase.from("routine_presets").insert(row).select("id").maybeSingle();
  const { data, error } = await query;
  if (error || !data) {
    const duplicate = error?.code === "23505";
    return NextResponse.json(
      {
        error: duplicate ? "duplicate_name" : "Failed to save",
        user_message: duplicate
          ? "You already have a preset with that name."
          : "The preset couldn't be saved just now — please try again.",
      },
      { status: duplicate ? 409 : 500 }
    );
  }
  if (!id) {
    // Categorical context type only — never the custom name.
    trackEvent("preset_created", {
      userId: user.id,
      properties: context ? { context_type: context } : {},
    });
  }
  return NextResponse.json({ ok: true, id: data.id });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { error } = await supabase
    .from("routine_presets")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: "Failed to remove" }, { status: 500 });
  }
  trackEvent("preset_removed", { userId: user.id });
  return NextResponse.json({ ok: true });
}
