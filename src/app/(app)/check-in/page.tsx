import type { Metadata } from "next";
import { CheckinForm } from "@/components/dailyflow/checkin-form";

export const metadata: Metadata = { title: "Daily check-in — DailyFlow" };

export default function CheckInPage() {
  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-[#1F2937]">
          How&apos;s today looking?
        </h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          Two minutes, no wrong answers — your plan adapts to you.
        </p>
      </div>
      <CheckinForm />
    </div>
  );
}
