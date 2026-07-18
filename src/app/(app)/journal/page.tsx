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
          Journal
        </h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          A place to notice how your days are going. General reflection, not
          therapy.
        </p>
      </div>
      <JournalView entries={(entries ?? []) as JournalEntry[]} />
    </div>
  );
}
