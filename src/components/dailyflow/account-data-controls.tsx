"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Download, Trash2, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/**
 * Privacy controls (Prompt 18): download all my data, and permanently delete
 * my account. Deletion requires typing DELETE and a second confirm click.
 */
export function AccountDataControls() {
  const router = useRouter();
  const [exporting, setExporting] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exportData() {
    setExporting(true);
    setError(null);
    try {
      const res = await fetch("/api/account/export");
      if (!res.ok) throw new Error("export_failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mellowa-data-export-${new Date()
        .toISOString()
        .slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("We couldn't prepare your export. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          data.user_message ||
            "We couldn't delete your account. Please try again."
        );
      }
      // Ensure the browser session is cleared, then leave.
      await createClient().auth.signOut();
      router.replace("/login");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setDeleting(false);
    }
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <h2 className="font-medium text-[#1F2937]">Your data, under your control</h2>
      <p className="mt-1 text-sm text-[#6B7280]">
        Download a machine-readable copy or permanently delete your account and
        linked data.
      </p>

      <div className="mt-4 space-y-3">
        <button
          onClick={exportData}
          disabled={exporting}
          className="flex items-center gap-2 rounded-xl border border-[#E5E1DA] px-4 py-2.5 text-sm font-medium text-[#1F2937] transition hover:border-[#7C9A92]/50 disabled:opacity-60"
        >
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Download my data (JSON)
        </button>
      </div>

      <div className="mt-6 border-t border-[#F0EDE7] pt-5">
        {!showConfirm ? (
          <button
            onClick={() => {
              setShowConfirm(true);
              setError(null);
            }}
            className="flex items-center gap-2 rounded-xl border border-[#FECACA] px-4 py-2.5 text-sm font-medium text-[#991B1B] transition hover:bg-[#FEE2E2]"
          >
            <Trash2 className="h-4 w-4" />
            Delete my account
          </button>
        ) : (
          <div className="rounded-xl bg-[#FEE2E2] p-4">
            <div className="flex items-start gap-2 text-sm text-[#991B1B]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                This permanently deletes your account and all your plans,
                check-ins, habits and journal entries. Any active subscription is
                cancelled. This cannot be undone.
              </p>
            </div>
            <label className="mt-3 block text-sm font-medium text-[#991B1B]">
              Type <span className="font-mono">DELETE</span> to confirm
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              className="mt-1 w-full rounded-xl border border-[#FECACA] bg-white px-4 py-2.5 text-sm text-[#1F2937] focus:border-[#991B1B] focus:outline-none"
            />
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={deleteAccount}
                disabled={confirmText !== "DELETE" || deleting}
                className="flex items-center gap-2 rounded-xl bg-[#991B1B] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#7F1616] disabled:opacity-50"
              >
                {deleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Permanently delete
              </button>
              <button
                onClick={() => {
                  setShowConfirm(false);
                  setConfirmText("");
                }}
                disabled={deleting}
                className="rounded-xl px-4 py-2.5 text-sm font-medium text-[#6B7280] transition hover:text-[#1F2937] disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-xl bg-[#FEE2E2] px-4 py-3 text-sm text-[#991B1B]">
          {error}
        </div>
      )}
    </div>
  );
}
