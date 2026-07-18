import type { Metadata } from "next";
import Link from "next/link";
import { readLegalConfig } from "@/lib/legal/config";

export const metadata: Metadata = { title: "Help & policies — Mellowa" };

const POLICIES = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/refund", label: "Refund Policy" },
];

export default function HelpPage() {
  const { supportEmail, privacyEmail } = readLegalConfig();

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-[#1F2937]">
          Help &amp; policies
        </h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          Get support and read how Mellowa works.
        </p>
      </header>

      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="font-medium text-[#1F2937]">Get help</h2>
        <p className="mt-1 text-sm text-[#6B7280]">
          For account, billing or privacy questions, email {supportEmail}. Paid
          support replies within 2 business days.
        </p>
        <p className="mt-2 text-xs text-[#9CA3AF]">
          Mellowa does not monitor this inbox for emergencies.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href={`mailto:${supportEmail}`}
            className="inline-block rounded-xl border border-[#E5E1DA] px-4 py-2.5 text-sm font-medium text-[#1F2937] transition hover:border-[#7C9A92]/50"
          >
            Email {supportEmail}
          </a>
          {privacyEmail !== supportEmail && (
            <a
              href={`mailto:${privacyEmail}`}
              className="inline-block rounded-xl border border-[#E5E1DA] px-4 py-2.5 text-sm font-medium text-[#1F2937] transition hover:border-[#7C9A92]/50"
            >
              Privacy: {privacyEmail}
            </a>
          )}
        </div>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="font-medium text-[#1F2937]">Policies</h2>
        <ul className="mt-3 space-y-2">
          {POLICIES.map(({ href, label }) => (
            <li key={href}>
              <Link
                href={href}
                className="text-sm font-medium text-[#6D8C7D] underline-offset-2 hover:underline"
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <p className="px-2 text-xs text-[#9CA3AF]">
        Mellowa is not medical care, therapy or emergency support.
      </p>
    </div>
  );
}
