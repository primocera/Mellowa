"use client";

import { useEffect } from "react";
import { Button, Callout } from "@/components/ui";

/**
 * MW-V9-09: app-level error boundary. A failed server read (Supabase/provider
 * down) shows a calm, serious recovery card with a retry instead of a blank
 * page. The surrounding app shell and navigation stay intact; no user data is
 * shown in the message, and nothing sensitive is logged client-side.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Digest only — never the message/stack, which could contain user context.
    console.error("[app] route error", { digest: error.digest });
  }, [error]);

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Callout tone="error">
        Something didn&apos;t load just now. Your saved plans and data are safe —
        this was a temporary problem reaching the server.
      </Callout>
      <Button variant="primary" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
