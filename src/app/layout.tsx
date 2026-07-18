import type { Metadata } from "next";
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
