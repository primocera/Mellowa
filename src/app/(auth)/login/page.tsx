import type { Metadata } from "next";
import { AuthForm } from "@/components/forms/auth-form";
import { parsePlanIntent, sanitizeNextPath } from "@/lib/auth/intent";

export const metadata: Metadata = { title: "Log in — Mellowa" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string; error?: string; plan?: string; next?: string }>;
}) {
  const { reset, error, plan, next } = await searchParams;

  return (
    <div className="space-y-4">
      {reset === "success" && (
        <div className="rounded-xl bg-[#DCFCE7] px-4 py-3 text-sm text-[#166534]">
          Your password has been updated. You can log in now.
        </div>
      )}
      {error === "verify_link_invalid" && (
        <div className="rounded-xl bg-[#FEE2E2] px-4 py-3 text-sm text-[#991B1B]">
          That verification link didn&rsquo;t work. Log in, or sign up again to
          get a new one.
        </div>
      )}
      <AuthForm
        mode="login"
        plan={parsePlanIntent(plan)}
        next={sanitizeNextPath(next)}
      />
    </div>
  );
}
