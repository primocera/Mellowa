import { redirect } from "next/navigation";

// Prompt 10: Dashboard was folded into Today. Preserve the old URL by
// redirecting so existing links, bookmarks and emails keep working.
export default function DashboardPage() {
  redirect("/today");
}
