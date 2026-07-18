import type { Metadata } from "next";
import { CheckinForm } from "@/components/dailyflow/checkin-form";

export const metadata: Metadata = { title: "Daily check-in — Mellowa" };

export default function CheckInPage() {
  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-[#1F2937]">
          What kind of day is this?
        </h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          One minute. Approximate is enough.
        </p>
      </div>
      <CheckinForm />
    </div>
  );
}
