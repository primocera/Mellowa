import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_STATUSES } from "@/lib/stripe/plans";
import { UpgradeButton } from "@/components/dailyflow/upgrade-button";
import type { Subscription } from "@/types/dailyflow";

export const metadata: Metadata = { title: "Billing — DailyFlow" };

export default async function BillingPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  const sub = data as Subscription | null;
  const isPro = !!sub?.status && ACTIVE_STATUSES.includes(sub.status);

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-[#1F2937]">
        Billing
      </h1>

      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="font-medium text-[#1F2937]">Your plan</h2>
        {isPro ? (
          <>
            <p className="mt-2 inline-block rounded-full bg-[#DCFCE7] px-3 py-1 text-sm font-medium text-[#166534]">
              Premium — {sub?.plan_name === "pro_yearly" ? "annual" : "monthly"}
            </p>
            {sub?.current_period_end && (
              <p className="mt-2 text-sm text-[#6B7280]">
                Renews on {new Date(sub.current_period_end).toLocaleDateString()}
              </p>
            )}
            <p className="mt-3 text-sm text-[#6B7280]">
              Thank you for supporting DailyFlow. You have full access to daily
              and weekly plans, meal rhythm, journal and progress.
            </p>
          </>
        ) : (
          <>
            <p className="mt-2 inline-block rounded-full bg-[#FAF7F2] px-3 py-1 text-sm font-medium text-[#6B7280]">
              Free plan
            </p>
            <p className="mt-3 text-sm text-[#6B7280]">
              You have daily check-ins, up to 5 daily plans a month and basic
              habits. Premium unlocks weekly plans, shopping lists, meal
              rhythm, journal reflections and progress insights.
            </p>
            <div className="mt-4 space-y-2">
              <UpgradeButton interval="monthly" label="Upgrade — $9/month" highlight />
              <UpgradeButton interval="yearly" label="Upgrade — $79/year" />
            </div>
          </>
        )}
      </div>

      <p className="px-2 text-xs text-[#9CA3AF]">
        Questions about billing? See{" "}
        <Link href="/pricing" className="text-[#7C9A92] hover:underline">
          pricing
        </Link>{" "}
        for what each plan includes.
      </p>
    </div>
  );
}
