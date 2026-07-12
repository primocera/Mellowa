import Link from "next/link";
import { Sparkles } from "lucide-react";
import { getUserSubscriptionStatus } from "@/lib/stripe/subscription";

/** Calm trial-status banner. Renders nothing outside an active trial. */
export async function TrialBanner({ userId }: { userId: string }) {
  const sub = await getUserSubscriptionStatus(userId);
  if (!sub.shouldShowTrialBanner) return null;

  const days = sub.daysLeftInTrial ?? 0;
  const message =
    days <= 1
      ? "Your Mellowa trial ends tomorrow. Keep your daily plans and weekly reset unlocked."
      : `Your 3-day Mellowa trial is active — ${days} days left.`;

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-[#EDE9FE]/70 px-4 py-3">
      <div className="flex items-center gap-2 text-sm text-[#1F2937]">
        <Sparkles className="h-4 w-4 shrink-0 text-[#7C9A92]" />
        {message}
      </div>
      <Link
        href="/billing"
        className="text-sm font-medium text-[#7C9A92] hover:underline"
      >
        Manage plan →
      </Link>
    </div>
  );
}
