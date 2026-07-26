"use client";

import { useEffect } from "react";
import { CalendarRange } from "lucide-react";
import { weekPreviewContent } from "@/lib/week/preview";
import { trackClient } from "@/lib/analytics/client";

/**
 * MW-V10-02: labelled Week-closeout preview for a trial shorter than a week.
 *
 * Every visual choice here exists to make "this is not your week" unmissable:
 * the badge sits in the heading, the example list is dashed and muted rather
 * than styled like a real recap card, and the disclaimer is inside the same
 * block — not a footnote that can be scrolled past. No number on this card is
 * derived from the user's rows.
 *
 * Client component only so the view can be counted once per mount, the same
 * pattern as the premium value card.
 */
export function WeekPreviewCard({ trialDays }: { trialDays: number }) {
  const content = weekPreviewContent();

  useEffect(() => {
    trackClient("trial_week_preview_viewed", { surface: "week" });
  }, []);

  return (
    <section
      className="rounded-2xl border border-dashed border-[#C9C3B8] bg-[#FAF7F2] p-5"
      aria-label="Example of a week closeout — not your data"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-[#EDE9FE] px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide text-[#4C1D95]">
          {content.label}
        </span>
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-[#1F2937]">
          <CalendarRange className="h-4 w-4 shrink-0 text-[#7C9A92]" />
          {content.heading}
        </h2>
      </div>

      <p className="mt-2 text-sm text-[#6B7280]">
        Your trial is {trialDays} {trialDays === 1 ? "day" : "days"}, so there is
        no full week to summarise yet. This is what this page shows once a week of
        your own days is recorded.
      </p>

      <ul className="mt-3 space-y-1.5">
        {content.exampleFacts.map((fact) => (
          <li key={fact} className="text-sm text-[#374151]">
            <span aria-hidden="true" className="mr-2 text-[#C9C3B8]">
              —
            </span>
            {fact}
          </li>
        ))}
      </ul>

      <h3 className="mt-4 text-xs font-medium uppercase tracking-wide text-[#9CA3AF]">
        And how carry forward would apply
      </h3>
      <ul className="mt-2 space-y-1.5">
        {content.carry.map((c) => (
          <li key={c.choice} className="text-sm text-[#374151]">
            <span className="font-medium">{c.choice}</span>
            <span className="text-[#9CA3AF]"> → </span>
            <span className="text-[#6B7280]">{c.effect}</span>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs text-[#6B7280]">{content.disclaimer}</p>
      <p className="mt-1 text-xs text-[#6B7280]">{content.nextStep}</p>
    </section>
  );
}
