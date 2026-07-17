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
    <AuthForm
      mode="signup"
      plan={parsePlanIntent(plan)}
      next={sanitizeNextPath(next)}
    />
  );
}
