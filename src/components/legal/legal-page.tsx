import Link from "next/link";
import type { ReactNode } from "react";
import { readLegalConfig } from "@/lib/legal/config";

/**
 * Shared shell for the static legal pages (privacy, terms, refunds).
 * Calm, readable, consistent with the marketing palette. Entity identity and
 * contact details come from the validated legal configuration — never
 * hardcoded (Launch audit v6, Prompt 3).
 */
export function LegalPage({
  title,
  lastUpdated,
  version,
  children,
}: {
  title: string;
  lastUpdated: string;
  version?: string;
  children: ReactNode;
}) {
  const legal = readLegalConfig();
  return (
    <div className="min-h-screen bg-[#FAF7F2] text-[#1F2937]">
      <header className="border-b border-[#EDE9E2] bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Mellowa
          </Link>
          <Link href="/" className="text-sm text-[#6B7280] hover:text-[#6D8C7D]">
            ← Back
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">
          Last reviewed: {lastUpdated}
          {version ? ` • Policy version ${version}` : null}
        </p>

        <div className="legal-body mt-8 space-y-6 text-[15px] leading-relaxed text-[#374151]">
          {children}
        </div>

        {(legal.entityName || legal.registeredAddress || legal.governingLaw) && (
          <div className="mt-12 rounded-2xl bg-white p-5 text-sm text-[#6B7280]">
            <h2 className="font-medium text-[#1F2937]">Service provider</h2>
            {legal.entityName && <p className="mt-2">{legal.entityName}</p>}
            {legal.registeredAddress && <p>{legal.registeredAddress}</p>}
            {legal.governingLaw && (
              <p className="mt-2">Governing law: {legal.governingLaw}</p>
            )}
            <p className="mt-2">
              Contact:{" "}
              <a
                href={`mailto:${legal.supportEmail}`}
                className="text-[#6D8C7D] underline"
              >
                {legal.supportEmail}
              </a>
            </p>
          </div>
        )}

        <div className="mt-12 flex flex-wrap gap-4 border-t border-[#EDE9E2] pt-6 text-sm text-[#6B7280]">
          <Link href="/privacy" className="hover:text-[#6D8C7D]">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-[#6D8C7D]">
            Terms
          </Link>
          <Link href="/refund" className="hover:text-[#6D8C7D]">
            Refunds
          </Link>
        </div>
      </main>
    </div>
  );
}

export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-medium text-[#1F2937]">{heading}</h2>
      {children}
    </section>
  );
}
