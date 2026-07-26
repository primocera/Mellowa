"use client";

/**
 * MW-V10-07: last-resort boundary for a failure in the root layout itself.
 *
 * When the root layout throws, no other boundary runs and no shared CSS, font
 * or provider is available — so this file renders its own <html> and <body> and
 * uses nothing but inline styles. Anything imported here could be the very
 * thing that failed.
 *
 * Without it, a root-layout failure shows an unstyled browser error page.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#FAF7F2",
          color: "#1F2937",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          fontFamily:
            "-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <p style={{ fontSize: 20, fontWeight: 600 }}>Mellowa</p>
          <h1 style={{ marginTop: 16, fontSize: 18, fontWeight: 600 }}>
            Mellowa couldn&rsquo;t start
          </h1>
          <p style={{ marginTop: 8, fontSize: 14, color: "#6B7280", lineHeight: 1.6 }}>
            This is a problem on our side. Your account and everything you have
            saved are unaffected.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 24,
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
            Reload
          </button>
          {/* The digest is the only thing that helps support correlate a report,
              and it contains no user data. */}
          {error.digest && (
            <p style={{ marginTop: 16, fontSize: 12, color: "#9CA3AF" }}>
              Reference: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
