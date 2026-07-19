import type { Metadata } from "next";
import Link from "next/link";
import { CheckinForm } from "@/components/dailyflow/checkin-form";
import { createClient } from "@/lib/supabase/server";
import { getUserPlan } from "@/lib/stripe/subscription";

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
  // Sample entitlement disclosure (MW-03): sample-tier users see exactly where
  // they stand before submitting — the next plan is the one lifetime free
  // sample, or the sample is used and ongoing generation needs Premium.
  let sampleState: "available" | "used" | null = null;
  let baseline: { stress?: number; sleep?: number } | undefined;
  if (user) {
    const plan = await getUserPlan(user.id);
    if (plan === "sample") {
      const { count } = await supabase
        .from("daily_plans")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);
      sampleState = (count ?? 0) > 0 ? "used" : "available";
    }
  }
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
          About a minute for the essentials. Approximate is enough.
        </p>
      </div>
      {sampleState === "available" && (
        <div className="mb-4 rounded-2xl bg-[#EEF2FF] px-4 py-3 text-sm text-[#1F2937]">
          This check-in creates your one free sample plan — no payment method
          needed. It stays yours to revisit.
        </div>
      )}
      {sampleState === "used" && (
        <div className="mb-4 rounded-2xl bg-white px-4 py-3 text-sm text-[#6B7280] shadow-sm">
          You&rsquo;ve used your free sample plan (it stays readable on Today).
          Creating new daily plans needs a Premium plan — see{" "}
          <Link href="/billing" className="font-medium text-[#7C9A92] hover:underline">
            Billing
          </Link>{" "}
          for options. Generation is subject to fair-use limits.
        </div>
      )}
      <CheckinForm baseline={baseline} />
    </div>
  );
}
