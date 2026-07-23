import { Skeleton } from "@/components/ui";

/** MW-V9-09: Today loading placeholder — mirrors the plan layout so the page
 *  doesn't jump when content arrives. Motion is disabled under reduced-motion. */
export default function TodayLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading today's plan">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-32 w-full rounded-2xl" />
      <Skeleton className="h-40 w-full rounded-2xl" />
      <Skeleton className="h-24 w-full rounded-2xl" />
    </div>
  );
}
