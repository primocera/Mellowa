import type { Metadata } from "next";
import { VerifyEmailCard } from "@/components/forms/verify-email-card";
import { parsePlanIntent, sanitizeNextPath } from "@/lib/auth/intent";

export const metadata: Metadata = { title: "Check your email — Mellowa" };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; plan?: string; next?: string; error?: string }>;
}) {
  const { email, plan, next, error } = await searchParams;

  return (
    <VerifyEmailCard
      email={email ?? null}
      plan={parsePlanIntent(plan)}
      next={sanitizeNextPath(next)}
      linkExpired={error === "link_expired"}
    />
  );
}
