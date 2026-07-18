import type { Metadata } from "next";
import { CheckinForm } from "@/components/dailyflow/checkin-form";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Daily check-in — Mellowa" };

/** Parse a stored baseline string ("1".."5") into a slider value. */
function toScale(value: string | null | undefined): number | undefined {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : undefined;
}

export default async function CheckInPage() {
  // Prefill the first check-in from onboarding baselines (Prompt 21) so the
  // free sample plan is one tap away. Falls back to neutral defaults.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Only stress and sleep baselines are persisted (see 001_initial_schema);
  // energy is a fresh daily signal, so it stays at the neutral default.
  let baseline: { stress?: number; sleep?: number } | undefined;
  if (user) {
    const { data } = await supabase
      .from("wellbeing_profiles")
      .select("stress_baseline, sleep_quality_baseline")
      .eq("user_id", user.id)
      .maybeSingle();
    if (data) {
      baseline = {
        stress: toScale(data.stress_baseline),
        sleep: toScale(data.sleep_quality_baseline),
      };
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-[#1F2937]">
          What kind of day is this?
        </h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          One minute. Approximate is enough.
        </p>
      </div>
      <CheckinForm baseline={baseline} />
    </div>
  );
}
