import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Daily check-in — DailyFlow" };

// Placeholder — full check-in form ships with Prompt 19.
export default function CheckInPage() {
  return (
    <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
      <h1 className="text-xl font-semibold text-[#1F2937]">Daily check-in</h1>
      <p className="mt-2 text-sm text-[#6B7280]">
        Your profile is saved. The daily check-in is coming next.
      </p>
      <Link
        href="/dashboard"
        className="mt-6 inline-block rounded-xl bg-[#7C9A92] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#6D8C7D]"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
