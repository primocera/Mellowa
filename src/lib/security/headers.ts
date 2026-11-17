/**
 * Response security headers (audit A1), applied to every route from
 * `next.config.ts`. Pure and dependency-free so the config file can import it
 * and the tests can assert on it without booting Next.
 *
 * Two tiers, on purpose:
 *
 *  1. ENFORCED today — headers that cannot break a page that works now:
 *     framing, MIME sniffing, referrer and feature policy.
 *  2. REPORT-ONLY — the Content-Security-Policy. It is sent as
 *     `Content-Security-Policy-Report-Only`, so the browser logs violations to
 *     the console and blocks nothing. It becomes enforcing only after an owner
 *     has clicked through the real app with a clean console.
 *
 * A report-only policy is not a control: `frame-ancestors` in it stops no
 * framing. Clickjacking protection therefore comes from the enforced
 * `X-Frame-Options: DENY`, not from the CSP.
 */

export interface SecurityHeader {
  key: string;
  value: string;
}

export interface SecurityHeaderOptions {
  /** `next dev` needs `'unsafe-eval'` (React debugging); production does not. */
  isDev?: boolean;
  /** NEXT_PUBLIC_SUPABASE_URL — the one cross-origin API the browser calls. */
  supabaseUrl?: string | null;
}

/** `https://x.supabase.co/…` → `["https://x.supabase.co", "wss://x.supabase.co"]`. */
function supabaseSources(supabaseUrl: string | null | undefined): string[] {
  if (!supabaseUrl) return [];
  try {
    const { protocol, host } = new URL(supabaseUrl);
    const ws = protocol === "http:" ? "ws:" : "wss:";
    return [`${protocol}//${host}`, `${ws}//${host}`];
  } catch {
    // A malformed URL must not take the whole build down over a header.
    return [];
  }
}

/**
 * The policy, as directive → sources. No nonces: nonces force every page to
 * render dynamically (Next docs, "Static vs Dynamic Rendering with CSP"), so
 * this follows the documented "Without Nonces" shape and keeps static pages
 * static. The price is `'unsafe-inline'` for scripts and styles — the policy
 * still pins where code, connections, frames and form posts may go.
 */
export function contentSecurityPolicyDirectives(
  opts: SecurityHeaderOptions = {}
): Record<string, string[]> {
  return {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(opts.isDev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    // blob: — the data-export download today, camera previews later (audit 06).
    "img-src": ["'self'", "blob:", "data:"],
    "media-src": ["'self'", "blob:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...supabaseSources(opts.supabaseUrl)],
    "worker-src": ["'self'", "blob:"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    // Checkout and the billing portal are top-level navigations to Stripe.
    "form-action": ["'self'", "https://checkout.stripe.com", "https://billing.stripe.com"],
    "frame-ancestors": ["'none'"],
  };
}

export function contentSecurityPolicy(opts: SecurityHeaderOptions = {}): string {
  return Object.entries(contentSecurityPolicyDirectives(opts))
    .map(([directive, sources]) => `${directive} ${sources.join(" ")}`)
    .join("; ");
}

/**
 * Feature policy. `camera=(self)` is deliberate: the camera stays available to
 * Mellowa's own origin (and to no embedded frame) so a future camera feature
 * is not silently blocked by a header written today. Everything else the app
 * has no use for is switched off.
 */
export const PERMISSIONS_POLICY = [
  "camera=(self)",
  "microphone=()",
  "geolocation=()",
  "browsing-topics=()",
].join(", ");

export function securityHeaders(opts: SecurityHeaderOptions = {}): SecurityHeader[] {
  return [
    // Enforced clickjacking protection (cancel, delete-account and checkout are
    // single-click actions behind cookie auth).
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
    // Report-only: observes, blocks nothing. See the file header.
    { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy(opts) },
  ];
}
