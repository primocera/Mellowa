import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkInputSafety } from "@/lib/safety/check-input";
import { generateStructuredJson, type UsageSink } from "@/lib/ai/generate-json";
import { AiGenerationError } from "@/lib/ai/errors";
import { DAILY_PLAN_V2_SYSTEM_PROMPT } from "@/prompts/daily-plan-v2";
import { guardAiRoute } from "@/lib/ai/guard";
import { finalizeAiUsage, releaseReservation, sumUsage } from "@/lib/ai/usage";
import { promptVersionId } from "@/prompts/versions";
import {
  claimGenerationRequest,
  finishGenerationRequest,
  isValidIdempotencyKey,
} from "@/lib/ai/idempotency";
import {
  findMealAllergenViolations,
  allergenExclusionInstruction,
} from "@/lib/safety/allergens";
import { checkRegeneratedMealOutput, correctiveInstruction } from "@/lib/ai/output-guards";
import {
  REPAIR_REASONS,
  REPAIR_REASON_INSTRUCTIONS,
  replaceableScope,
  repairOutputSchema,
  buildRepairUpdates,
  type RepairPlanRow,
} from "@/lib/plan/repair";
import type { MealCardType } from "@/schemas/ai-output-v2";
import { trackEvent } from "@/lib/analytics";
import { isFlagEnabled } from "@/lib/flags";
import { checkPlanIsToday } from "@/lib/today/mutation-guard";

/**
 * MW-S02: atomic "Adjust the rest of today".
 *
 * One AI response covering only the remaining replaceable sections, validated
 * as a whole, committed in ONE database transaction (apply_plan_repair RPC)
 * with a version snapshot for free Undo. Completed and explicitly kept items
 * are never sent for replacement and are carried over unchanged. Failure at
 * any point leaves the prior plan untouched; blocked input consumes no
 * entitlement and never triggers an upsell.
 */

const RepairInput = z.object({
  plan_id: z.string().uuid(),
  reason: z.enum(REPAIR_REASONS),
  keep_keys: z.array(z.string().min(1).max(80)).max(30).default([]),
  user_note: z.string().max(1000).optional().default(""),
});

const PROMPT_VERSION = promptVersionId("daily-plan-v2");

function sectionsSlug(changedTypes: string[]): string {
  return changedTypes.join("-") || "none";
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // MW-S10: experiment rollback switch — disabling the flag pauses the
  // surface with honest copy and no data change.
  if (!isFlagEnabled("plan_repair")) {
    return NextResponse.json(
      {
        error: "feature_paused",
        user_message:
          "Adjusting the rest of today is briefly paused. Your plan is unchanged — please try again later.",
      },
      { status: 503 }
    );
  }

  const guard = await guardAiRoute(user.id, {
    requirePremium: true,
    route: "plan-repair",
  });
  if (guard instanceof NextResponse) return guard;
  const eventId = guard.eventId;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    await releaseReservation(eventId);
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = RepairInput.safeParse(body);
  if (!parsed.success) {
    await releaseReservation(eventId);
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { plan_id, reason, keep_keys, user_note } = parsed.data;

  // One repair attempt per idempotency key: a retry or double-tap sees the
  // in-flight/committed attempt instead of spending another claim.
  const idempotencyKey = request.headers.get("x-idempotency-key");
  let requestId: string | null = null;
  if (isValidIdempotencyKey(idempotencyKey)) {
    const claim = await claimGenerationRequest(supabase, {
      userId: user.id,
      route: "plan-repair",
      idempotencyKey,
    });
    if (!claim.claimed) {
      await releaseReservation(eventId);
      if (claim.status === "succeeded") {
        return NextResponse.json({ deduplicated: true, plan_id: claim.resultId });
      }
      return NextResponse.json(
        { error: "repair_in_progress", user_message: "This adjustment is already being created." },
        { status: 409 }
      );
    }
    requestId = claim.requestId;
  }

  const fail = async (status: number, payload: Record<string, unknown>) => {
    await finishGenerationRequest(supabase, {
      requestId,
      userId: user.id,
      status: "failed",
    });
    return NextResponse.json(payload, { status });
  };

  // Server-derived ownership: the plan must belong to this user (RLS + filter).
  // A query ERROR is an outage, not a missing plan — fail closed (503) rather
  // than mutating/adjusting from an unobserved state. Only a successful no-row
  // result is a genuine 404.
  const { data: plan, error: planError } = await supabase
    .from("daily_plans")
    .select("*")
    .eq("id", plan_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (planError) {
    await releaseReservation(eventId);
    return fail(503, {
      error: "data_unavailable",
      user_message:
        "We couldn't confirm today's plan just now — nothing was changed. Please try again in a moment.",
    });
  }
  if (!plan) {
    await releaseReservation(eventId);
    return fail(404, { error: "Plan not found" });
  }

  // MW-02: only today's canonical plan can be adjusted. If the day rolled over
  // while this tab was open (or a stale/forged request targets a past day),
  // refuse with a stable 409 rather than mutating a historical plan.
  const dayState = await checkPlanIsToday(supabase, user.id, plan.plan_date as string);
  if (dayState === "unavailable") {
    // MW-03: timezone read outage — fail closed rather than adjust the plan
    // against a UTC-fallback day.
    await releaseReservation(eventId);
    return fail(503, {
      error: "data_unavailable",
      user_message:
        "We couldn't confirm today's plan just now — nothing was changed. Please try again in a moment.",
    });
  }
  if (dayState !== "ok") {
    await releaseReservation(eventId);
    return fail(409, {
      error: "stale_day",
      user_message:
        "Your day has moved on since this page loaded, so this plan is no longer today's. Refresh to adjust today's plan.",
    });
  }

  trackEvent("plan_repair_requested", {
    userId: user.id,
    properties: { repair_reason: reason },
  });

  // Safety classification BEFORE any generation. The optional note follows the
  // full safety path and is used for this request only — never stored as memory.
  if (user_note) {
    const safety = await checkInputSafety(user.id, "plan-repair", user_note);
    if (safety.should_block_generation) {
      await finalizeAiUsage(eventId, {
        status: "safety_blocked",
        promptVersion: PROMPT_VERSION,
      });
      await finishGenerationRequest(supabase, {
        requestId,
        userId: user.id,
        status: "failed",
      });
      return NextResponse.json(
        { blocked: true, user_message: safety.user_message },
        { status: 200 }
      );
    }
  }

  // Completed items are protected server-side from the persisted rows — the
  // client cannot un-protect them by omitting keys. A READ ERROR here must never
  // be collapsed into "no completed items": that could let the adjustment
  // replace an item the user already finished. Fail closed before building the
  // replaceable scope or calling the provider. A successful no-row read is a
  // genuine "nothing completed yet" and is safe to treat as [].
  const { data: completions, error: completionsError } = await supabase
    .from("plan_completions")
    .select("item_key")
    .eq("daily_plan_id", plan_id);
  if (completionsError) {
    await releaseReservation(eventId);
    return fail(503, {
      error: "data_unavailable",
      user_message:
        "We couldn't confirm today's plan just now — nothing was changed. Please try again in a moment.",
    });
  }
  const completedKeys = (completions ?? []).map((c) => c.item_key);

  const scope = replaceableScope(plan as RepairPlanRow, completedKeys, keep_keys);
  if (!scope.mealTypes.length && !scope.sections.length) {
    await releaseReservation(eventId);
    return fail(400, {
      error: "nothing_to_adjust",
      user_message:
        "Everything left in today's plan is marked done or kept, so there's nothing to adjust. No plan generation was used.",
    });
  }

  // Allergies, food preferences and movement limitations are required SAFETY
  // context for the repair prompt. A read ERROR must never become an empty
  // allergy list — fail closed. A verified-absent profile means onboarding is
  // incomplete: we cannot honour allergies/limitations, so refuse rather than
  // generate blind (mirrors the daily-plan route's onboarding_required guard).
  const { data: profile, error: profileError } = await supabase
    .from("wellbeing_profiles")
    .select(
      "primary_goal, cooking_time, cooking_skill, budget_level, movement_level, movement_limitations, food_preferences, allergies, preferred_tone"
    )
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileError) {
    await releaseReservation(eventId);
    return fail(503, {
      error: "data_unavailable",
      user_message:
        "We couldn't confirm your wellbeing profile just now — nothing was changed. Please try again in a moment.",
    });
  }
  if (!profile) {
    await releaseReservation(eventId);
    return fail(400, {
      error: "onboarding_required",
      user_message:
        "Let's finish your wellbeing setup first — nothing was changed.",
    });
  }
  const allergies = (profile.allergies ?? []).filter(Boolean);

  const schema = repairOutputSchema(scope);
  const currentOpen: Record<string, unknown> = {};
  if (scope.mealTypes.length) {
    currentOpen.meal_cards = ((plan.meal_cards as MealCardType[] | null) ?? []).filter(
      (m) => scope.mealTypes.includes(m.meal_type)
    );
  }
  for (const section of scope.sections) currentOpen[section] = plan[section];

  const expectedKeys = [
    "repair_summary",
    ...(scope.mealTypes.length ? ["meal_cards"] : []),
    ...scope.sections,
  ];

  const userPrompt = `The user has an existing daily plan and the day changed. Repair ONLY the remaining, still-open parts in one pass.

Reason: ${REPAIR_REASON_INSTRUCTIONS[reason]}
${user_note ? `User note (context for this repair only): """${user_note}"""` : ""}

User profile (respect allergies, preferences, cooking skill and limitations):
${JSON.stringify(profile, null, 2)}

Current still-open sections to replace:
${JSON.stringify(currentOpen, null, 2)}

Plan summary for context:
${JSON.stringify(plan.plan_summary, null, 2)}

Return ONE JSON object with EXACTLY these keys and nothing else: ${expectedKeys.join(", ")}.
- "repair_summary": one or two calm sentences describing what changed and why it is lighter, without judgment.
${scope.mealTypes.length ? `- "meal_cards": exactly ${scope.mealTypes.length} meal card(s) for meal_type(s): ${scope.mealTypes.join(", ")} — same shape as the current cards.` : ""}
- Every replaced section keeps the same JSON shape as the current content. Keep everything consistent with the reason and all Mellowa safety rules. Do not mention items you are not replacing.`;

  const gateMeals = (cards: MealCardType[]): string[] => {
    const reasons: string[] = [];
    for (const card of cards) {
      if (allergies.length) {
        reasons.push(
          ...findMealAllergenViolations(card, allergies).map((v) => `allergen:${v.category}`)
        );
      }
      const q = checkRegeneratedMealOutput(card);
      if (!q.ok) reasons.push(...q.reasons);
    }
    return reasons;
  };

  const sink1: UsageSink = {};
  const sink2: UsageSink = {};
  let retried = false;
  let repair: Record<string, unknown>;
  try {
    repair = (await generateStructuredJson({
      route: "plan-repair",
      systemPrompt: DAILY_PLAN_V2_SYSTEM_PROMPT,
      userPrompt,
      zodSchema: schema,
      temperature: 0.6,
      maxTokens: 4096,
      usageSink: sink1,
    })) as Record<string, unknown>;

    let gate = gateMeals((repair.meal_cards as MealCardType[] | undefined) ?? []);
    if (gate.length) {
      retried = true;
      console.error("[safety] plan repair failed meal gate, retrying", { gate });
      repair = (await generateStructuredJson({
        route: "plan-repair",
        systemPrompt: DAILY_PLAN_V2_SYSTEM_PROMPT,
        userPrompt: `${userPrompt}

IMPORTANT CORRECTION: ${correctiveInstruction(gate)}${
          gate.some((g) => g.startsWith("allergen:"))
            ? `

${allergenExclusionInstruction(allergies)}`
            : ""
        }`,
        zodSchema: schema,
        temperature: 0.4,
        maxTokens: 4096,
        usageSink: sink2,
      })) as Record<string, unknown>;
      gate = gateMeals((repair.meal_cards as MealCardType[] | undefined) ?? []);
      if (gate.length) {
        console.error("[safety] plan repair failed meal gate after retry, failing closed", { gate });
        await finalizeAiUsage(eventId, {
          status: gate.some((g) => g.startsWith("allergen:"))
            ? "safety_blocked"
            : "quality_failed",
          promptVersion: PROMPT_VERSION,
          usage: sumUsage([sink1.usage, sink2.usage], "quality_failed"),
          retryCount: 1,
        });
        trackEvent("plan_repair_failed", {
          userId: user.id,
          properties: { repair_reason: reason, outcome: "blocked" },
        });
        return fail(502, {
          error: "repair_check_failed",
          user_message:
            "We couldn't create an adjustment we're confident is right for you. Your previous plan is unchanged. This attempt counts toward fair-use pacing; please try again.",
        });
      }
    }
  } catch (err) {
    const code = err instanceof AiGenerationError ? err.code : "provider_error";
    const failStatus = sink2.usage?.status ?? sink1.usage?.status ?? "provider_error";
    await finalizeAiUsage(eventId, {
      status: failStatus,
      promptVersion: PROMPT_VERSION,
      usage: sumUsage([sink1.usage, sink2.usage], failStatus),
      retryCount: retried ? 1 : 0,
    });
    trackEvent("plan_repair_failed", {
      userId: user.id,
      properties: { repair_reason: reason, outcome: "failure" },
    });
    return fail(502, {
      error: "Repair failed",
      code,
      user_message:
        "The adjustment didn't come through. Your previous plan is unchanged. Please try again in a moment.",
    });
  }

  const { updates, changedTypes } = buildRepairUpdates(
    plan as RepairPlanRow,
    scope,
    repair
  );

  // ONE transaction: snapshot the prior sections and apply the new ones.
  const { data: version, error: applyError } = await supabase.rpc("apply_plan_repair", {
    p_user_id: user.id,
    p_plan_id: plan_id,
    p_updates: updates,
    p_reason: reason,
    p_changed: changedTypes,
  });

  const usage = {
    promptVersion: PROMPT_VERSION,
    usage: sumUsage([sink1.usage, sink2.usage], "success"),
    retryCount: retried ? 1 : 0,
  };
  if (applyError) {
    console.error("[plan-repair] apply failed — plan unchanged", {
      message: applyError.message,
    });
    await finalizeAiUsage(eventId, { ...usage, status: "provider_error" });
    trackEvent("plan_repair_failed", {
      userId: user.id,
      properties: { repair_reason: reason, outcome: "failure" },
    });
    return fail(500, {
      error: "Failed to save",
      user_message:
        "The adjustment couldn't be saved. Your previous plan is unchanged. Please try again.",
    });
  }

  await finalizeAiUsage(eventId, { ...usage, status: "success", resultId: plan_id });
  await finishGenerationRequest(supabase, {
    requestId,
    userId: user.id,
    status: "succeeded",
    resultId: plan_id,
  });
  trackEvent("plan_repair_completed", {
    userId: user.id,
    properties: {
      repair_reason: reason,
      sections: sectionsSlug(changedTypes),
      outcome: "success",
    },
  });

  // MW-V9-04: the factual diff the UI shows is derived from these
  // server-computed categorical fields, never from repair_summary.
  return NextResponse.json({
    blocked: false,
    repair_summary: repair.repair_summary,
    changed_sections: changedTypes,
    kept_count: keep_keys.length,
    completed_count: completedKeys.length,
    version,
  });
}

/** Undo the newest repair — restores the prior version. Free, no AI call. */
export async function DELETE(request: Request) {
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
  const parsed = z
    .object({
      plan_id: z.string().uuid(),
      expected_version: z.number().int().positive().optional(),
    })
    .safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // MW-V9-04: when the client says which version it is undoing, the RPC
  // (migration 034) refuses to unwind a newer repair made in another tab.
  const { expected_version } = parsed.data;
  const { data: version, error } = await supabase.rpc(
    "undo_plan_repair",
    expected_version != null
      ? {
          p_user_id: user.id,
          p_plan_id: parsed.data.plan_id,
          p_expected_version: expected_version,
        }
      : { p_user_id: user.id, p_plan_id: parsed.data.plan_id }
  );
  if (error) {
    if (error.message?.includes("version_conflict")) {
      return NextResponse.json(
        {
          error: "version_conflict",
          user_message:
            "This plan was adjusted again since this page loaded. Refresh to see the latest version before undoing.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Undo failed", user_message: "Undo didn't go through — please try again." },
      { status: 500 }
    );
  }
  if (version != null) {
    trackEvent("plan_repair_undone", { userId: user.id });
  }
  return NextResponse.json({ undone: version != null });
}
