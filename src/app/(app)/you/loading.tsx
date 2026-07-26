import { Skeleton } from "@/components/ui";

/** MW-V10-07: You loading placeholder — mirrors the personalization sections. */
export default function YouLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading your preferences">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-36 w-full rounded-2xl" />
      <Skeleton className="h-36 w-full rounded-2xl" />
    </div>
  );
}
