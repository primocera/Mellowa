import { Skeleton } from "@/components/ui";

/** MW-V9-09: Week loading placeholder for the three-section loop. */
export default function WeeklyPlanLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading your week">
      <Skeleton className="h-28 w-full rounded-2xl" />
      <Skeleton className="h-40 w-full rounded-2xl" />
      <Skeleton className="h-48 w-full rounded-2xl" />
    </div>
  );
}
