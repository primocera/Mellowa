import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";
import { PlanPreferencesForm } from "@/components/dailyflow/plan-preferences-form";
import { AccountDataControls } from "@/components/dailyflow/account-data-controls";
import { MellowaLearned } from "@/components/dailyflow/mellowa-learned";
import type { WellbeingProfile } from "@/types/dailyflow";
import { readLegalConfig } from "@/lib/legal/config";

export const metadata: Metadata = { title: "Settings — Mellowa" };

export default async function SettingsPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data } = await supabase
    .from("wellbeing_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  const profile = data as WellbeingProfile | null;

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-[#1F2937]">
          Shape how Mellowa plans
        </h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          Change the details that affect future plans. Your existing plans stay
          as they are.
        </p>
      </header>

      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="font-medium text-[#1F2937]">Account</h2>
        <p className="mt-1 text-sm text-[#6B7280]">{user.email}</p>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="font-medium text-[#1F2937]">Your wellbeing profile</h2>
        {profile ? (
          <>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-[#6B7280]">Main goal</dt>
                <dd className="text-right text-[#1F2937]">
                  {profile.primary_goal?.replaceAll("_", " ")}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[#6B7280]">Rhythm</dt>
                <dd className="text-right text-[#1F2937]">
                  {profile.wake_time} – {profile.sleep_time}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[#6B7280]">Tone</dt>
                <dd className="text-right text-[#1F2937]">{profile.preferred_tone}</dd>
              </div>
            </dl>
            <Link
              href="/onboarding"
              className="mt-4 inline-block rounded-xl border border-[#E5E1DA] px-4 py-2.5 text-sm font-medium text-[#1F2937] transition hover:border-[#7C9A92]/50"
            >
              Update my profile
            </Link>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-[#6B7280]">
              You haven&apos;t set up your profile yet.
            </p>
            <Link
              href="/onboarding"
              className="mt-4 inline-block rounded-xl bg-[#7C9A92] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#6D8C7D]"
            >
              Start onboarding
            </Link>
          </>
        )}
      </div>

      {profile && (
        <PlanPreferencesForm
          userId={user.id}
          initial={{
            show_macros: profile.show_macros,
            macro_focus: profile.macro_focus ?? "",
            preferred_meal_prep_time: profile.preferred_meal_prep_time ?? "",
            cooking_skill: profile.cooking_skill ?? "",
            movement_preference: profile.movement_preference ?? [],
            movement_limitations: profile.movement_limitations ?? "",
            stress_reset_preference: profile.stress_reset_preference ?? [],
            meditation_experience: profile.meditation_experience ?? "",
            preferred_routine_length: profile.preferred_routine_length ?? "",
            schedule_type: profile.schedule_type ?? "",
            meal_pattern: profile.meal_pattern ?? "",
            disliked_ingredients: profile.disliked_ingredients ?? [],
            kitchen_equipment: profile.kitchen_equipment ?? [],
            default_servings: profile.default_servings ?? 1,
            reminders_opt_in: profile.reminders_opt_in ?? false,
            reminder_time: profile.reminder_time ?? "",
            quiet_hours_start: profile.quiet_hours_start ?? "",
            quiet_hours_end: profile.quiet_hours_end ?? "",
            meal_reuse_favourites: profile.meal_reuse_favourites ?? false,
            meal_repeat_leftovers: profile.meal_repeat_leftovers ?? false,
            meal_variety_level: profile.meal_variety_level ?? "",
            pantry_items: profile.pantry_items ?? [],
          }}
        />
      )}

      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="font-medium text-[#1F2937]">Subscription</h2>
        <p className="mt-1 text-sm text-[#6B7280]">
          Manage your plan and billing details.
        </p>
        <Link
          href="/billing"
          className="mt-4 inline-block rounded-xl border border-[#E5E1DA] px-4 py-2.5 text-sm font-medium text-[#1F2937] transition hover:border-[#7C9A92]/50"
        >
          Go to billing
        </Link>
      </div>

      <MellowaLearned />

      <div id="data">
        <AccountDataControls />
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="font-medium text-[#1F2937]">Get help</h2>
        <p className="mt-1 text-sm text-[#6B7280]">
          For account, billing or privacy questions, email us. Paid support
          replies within 2 business days. Mellowa does not monitor this inbox
          for emergencies.
        </p>
        <a
          href={`mailto:${readLegalConfig().supportEmail}`}
          className="mt-4 inline-block rounded-xl border border-[#E5E1DA] px-4 py-2.5 text-sm font-medium text-[#1F2937] transition hover:border-[#7C9A92]/50"
        >
          Email {readLegalConfig().supportEmail}
        </a>
      </div>

      <p className="px-2 text-xs text-[#9CA3AF]">
        Mellowa is not medical care, therapy or emergency support.
      </p>
    </div>
  );
}
