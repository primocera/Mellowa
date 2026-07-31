import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SITE_URL } from "@/lib/seo/site";
import { WebVitals } from "@/components/dailyflow/web-vitals";

/** The deploy's commit sha (Vercel), truncated, for field-vitals build tagging. */
function buildId(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_BUILD_ID;
  return sha ? sha.slice(0, 12) : "dev";
}

/*
 * MW-V11-05: both webfonts were removed, because measurement showed nothing
 * rendered them.
 *
 * Geist and Geist_Mono were loaded here and exposed as `--font-geist-sans` /
 * `--font-geist-mono`, which `globals.css` mapped to Tailwind's `--font-sans`
 * and `--font-mono`. But no component uses `font-sans`, only one word in the
 * account-deletion confirmation uses `font-mono`, and `globals.css` sets
 * `body { font-family: Arial, Helvetica, sans-serif }` — which wins. So the
 * product has been rendering in Arial the whole time while downloading 52,996
 * bytes of fonts it never painted, on every page, on the critical path.
 *
 * Deleting them is strictly a subtraction: nothing on screen changes, because
 * nothing on screen was using them. What changes is 21% of the landing page's
 * transferred bytes and two render-blocking requests.
 *
 * NOT done here, deliberately: actually adopting Geist. That would change the
 * typeface of every screen in the product, which is a design decision and not a
 * launch-hardening one. It is recorded for the owner instead.
 */

const TITLE = "Mellowa — A simple daily plan for food, energy, mood and habits";
const DESCRIPTION =
  "Realistic daily wellbeing plans that adapt to your energy, mood and schedule — without strict dieting or overwhelm.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s · Mellowa" },
  description: DESCRIPTION,
  applicationName: "Mellowa",
  manifest: "/manifest.webmanifest",
  // MW-V9-09: real PNG icons (generated from the brand mark) for the browser
  // tab, the PWA install prompt and iOS home-screen add.
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "Mellowa",
    statusBarStyle: "default",
  },
  openGraph: {
    type: "website",
    siteName: "Mellowa",
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    locale: "en",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  // Default policy is indexable; private layouts/pages set their own noindex.
  robots: { index: true, follow: true },
};

// MW-V9-09: theme-color for mobile browser chrome, matching the manifest.
export const viewport: Viewport = {
  themeColor: "#7C9A92",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col bg-[#FAF7F2] text-[#1F2937]">
        {children}
        {/* MW-V12-07: anonymous real-user Web Vitals (LCP/CLS/INP). Build id is
            the deploy commit, truncated; never a user identifier. */}
        <WebVitals buildId={buildId()} />
      </body>
    </html>
  );
}
