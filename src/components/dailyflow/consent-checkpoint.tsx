"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

/**
 * Light consent checkpoint (Prompt 6, audit v5). Shown to signed-in users
 * missing a required consent at the current policy version (e.g. accounts
 * created before the age gate, or after a policy update). Blocks nothing
 * except AI generation — the server enforces that independently.
 */
export function ConsentCheckpoint() {
  const [needed, setNeeded] = useState(false);
  const [age18, setAge18] = useState(false);
  const [policies, setPolicies] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/consent")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => setNeeded(s ? !s.complete : false))
      .catch(() => {});
  }, []);

  if (!needed) return null;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ age_18_plus: true, terms_and_privacy: true }),
      });
      if (res.ok) {
        setNeeded(false);
        return;
      }
      setError("Couldn't save your confirmation — please try again.");
    } catch {
      setError("Couldn't save your confirmation — please try again.");
    }
    setBusy(false);
  }

  return (
    <div className="mb-4 rounded-2xl border border-[#E5E1DA] bg-white p-5 shadow-sm">
      <h2 className="font-medium text-[#1F2937]">A quick confirmation</h2>
      <p className="mt-1 text-sm text-[#6B7280]">
        Before your next plan, please confirm the following. Mellowa is for
        adults and isn&apos;t medical care, therapy or emergency support.
      </p>
      <div className="mt-3 space-y-2.5">
        <label className="flex items-start gap-2.5 text-sm text-[#1F2937]">
          <input
            type="checkbox"
            checked={age18}
            onChange={(e) => setAge18(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-[#E5E1DA] accent-[#7C9A92]"
          />
          <span>I am at least 18 years old</span>
        </label>
        <label className="flex items-start gap-2.5 text-sm text-[#1F2937]">
          <input
            type="checkbox"
            checked={policies}
            onChange={(e) => setPolicies(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-[#E5E1DA] accent-[#7C9A92]"
          />
          <span>
            I agree to the{" "}
            <Link href="/terms" className="text-[#7C9A92] underline" target="_blank">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-[#7C9A92] underline" target="_blank">
              Privacy Policy
            </Link>
          </span>
        </label>
      </div>
      <button
        onClick={confirm}
        disabled={!age18 || !policies || busy}
        className="mt-4 flex items-center gap-2 rounded-xl bg-[#7C9A92] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#6D8C7D] disabled:opacity-60"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Confirm and continue
      </button>
      {error && <p className="mt-2 text-xs text-[#991B1B]">{error}</p>}
    </div>
  );
}
