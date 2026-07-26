import { Skeleton } from "@/components/ui";

/**
 * MW-V10-07: check-in loading placeholder. This route reads the profile and any
 * saved routine presets before rendering, so without a boundary the page blanked
 * on a slow connection — on the screen a user opens every day.
 *
 * The shape mirrors the real form (heading, the sliders block, the mode chips,
 * the submit row) so nothing jumps when content arrives.
 */
export default function CheckInLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading your check-in">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-56 w-full rounded-2xl" />
      <Skeleton className="h-32 w-full rounded-2xl" />
      <Skeleton className="h-12 w-full rounded-xl" />
    </div>
  );
}
