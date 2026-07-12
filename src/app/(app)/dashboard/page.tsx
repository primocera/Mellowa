import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/get-current-user";

export const metadata: Metadata = { title: "Dashboard — DailyFlow" };

export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[#1F2937]">
          Welcome back
        </h1>
        <p className="mt-1 text-sm text-[#6B7280]">{user.email}</p>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="font-medium text-[#1F2937]">Today</h2>
        <p className="mt-1 text-sm text-[#6B7280]">
          Start with a quick check-in to get your plan for today.
        </p>
        <Link
          href="/check-in"
          className="mt-4 inline-block rounded-xl bg-[#7C9A92] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#6D8C7D]"
        >
          Start daily check-in
        </Link>
      </div>
    </div>
  );
}
