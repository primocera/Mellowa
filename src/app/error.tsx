"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * MW-V10-07: error boundary for the PUBLIC routes.
 *
 * `(app)/error.tsx` covered the authenticated surfaces; the landing, pricing,
 * legal and auth pages had no boundary at all, so a failed server read there
 * produced Next's default error screen — on the first page a prospective user
 * ever sees.
 *
 * Deliberately self-contained (no shared imports, its own inline styles): if
 * the failure is in a shared module, a boundary that imports shared code can
 * fail to render too.
 */
export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Digest only. A public error message can contain request context, so it is
    // never logged from the browser.
    console.error("[public] route error", { digest: error.digest });
  }, [error]);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#FAF7F2",
        color: "#1F2937",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <p style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>
          Mellowa
        </p>
        <h1 style={{ marginTop: 16, fontSize: 18, fontWeight: 600 }}>
          This page didn&rsquo;t load
        </h1>
        <p style={{ marginTop: 8, fontSize: 14, color: "#6B7280", lineHeight: 1.6 }}>
          Something went wrong on our side, not yours. Nothing was saved or
          changed. Trying again usually works.
        </p>
        <div
          style={{
            marginTop: 24,
            display: "flex",
            gap: 12,
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={reset}
            style={{
              minHeight: 44,
              padding: "0 20px",
              borderRadius: 12,
              border: "none",
              background: "#7C9A92",
              color: "#fff",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          <Link
            href="/"
            style={{
              minHeight: 44,
              display: "inline-flex",
              alignItems: "center",
              padding: "0 20px",
              borderRadius: 12,
              border: "1px solid #E5E1DA",
              background: "#fff",
              color: "#1F2937",
              fontSize: 14,
              textDecoration: "none",
            }}
          >
            Go to the homepage
          </Link>
        </div>
      </div>
    </main>
  );
}
