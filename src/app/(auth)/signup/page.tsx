import type { Metadata } from "next";
import { AuthForm } from "@/components/forms/auth-form";
import { parsePlanIntent, sanitizeNextPath } from "@/lib/auth/intent";

export const metadata: Metadata = { title: "Sign up — Mellowa" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; next?: string }>;
}) {
  const { plan, next } = await searchParams;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-[#1F2937]">
          Create your Mellowa account
        </h2>
        <p className="mt-1 text-sm text-[#6B7280]">
          Your free sample day starts after a short setup. No card required.
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
