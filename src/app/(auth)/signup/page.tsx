import type { Metadata } from "next";
import { AuthForm } from "@/components/forms/auth-form";
import { parsePlanIntent, sanitizeNextPath } from "@/lib/auth/intent";
import { createAdminClient } from "@/lib/supabase/admin";
import { readBetaCapacity, BETA_CLOSED_MESSAGE } from "@/lib/beta/capacity";

export const metadata: Metadata = { title: "Sign up — Mellowa" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; next?: string }>;
}) {
  const { plan, next } = await searchParams;

  // MW-V10-06: the cap is enforced by a database trigger, so the form would
  // reject the signup anyway. Checking here means we say so BEFORE someone
  // types an email and a password, rather than after. If capacity cannot be
  // read we show the form: an unreadable setting must never lock people out.
  let full = false;
  try {
    const capacity = await readBetaCapacity(createAdminClient());
    full = capacity?.full ?? false;
  } catch {
    full = false;
  }

  if (full) {
    return (
      <div className="space-y-5">
        <h2 className="text-xl font-semibold text-[#1F2937]">
          Mellowa isn&rsquo;t open right now
        </h2>
        <p className="text-sm text-[#6B7280]">{BETA_CLOSED_MESSAGE}</p>
        <p className="text-sm text-[#6B7280]">
          Already have an account?{" "}
          <a href="/login" className="text-[#7C9A92] underline underline-offset-2">
            Log in
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-[#1F2937]">
          Create your Mellowa account
        </h2>
        <p className="mt-1 text-sm text-[#6B7280]">
          You&rsquo;ll set up a short planning baseline, then get one free
          sample day plan. No payment method until you choose Premium.
        </p>
      </div>
      <AuthForm
        mode="signup"
        plan={parsePlanIntent(plan)}
        next={sanitizeNextPath(next)}
      />
    </div>
  );
}
