import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/get-current-user";
import { createClient } from "@/lib/supabase/server";
import { JournalView } from "@/components/dailyflow/journal-view";
import type { JournalEntry } from "@/types/dailyflow";

export const metadata: Metadata = { title: "Journal — Mellowa" };

export default async function JournalPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: entries } = await supabase
    .from("journal_entries")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-[#1F2937]">
          Put the day somewhere
        </h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          A private place to write. Mellowa can offer a general reflection, not
          therapy or psychological interpretation.
        </p>
      </div>
      <JournalView entries={(entries ?? []) as JournalEntry[]} />
    </div>
  );
}
