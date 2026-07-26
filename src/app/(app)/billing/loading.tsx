import { Skeleton } from "@/components/ui";

/**
 * MW-V10-07: billing loading placeholder. This route may sync with Stripe on
 * return from checkout, which is the slowest read in the app and the one where a
 * blank screen is most alarming — the user has just paid.
 */
export default function BillingLoading() {
  return (
    <div className="mx-auto max-w-lg space-y-4" aria-busy="true" aria-label="Loading billing">
      <Skeleton className="h-7 w-28" />
      <Skeleton className="h-48 w-full rounded-2xl" />
      <Skeleton className="h-28 w-full rounded-2xl" />
    </div>
  );
}
