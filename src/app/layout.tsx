import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SITE_URL } from "@/lib/seo/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#FAF7F2] text-[#1F2937]">
        {children}
      </body>
    </html>
  );
}
