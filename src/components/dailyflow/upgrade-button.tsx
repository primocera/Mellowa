"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export function UpgradeButton({
  interval,
  label,
  highlight = false,
}: {
  interval: "monthly" | "yearly";
  label: string;
  highlight?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkout() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval }),
      });
      const data = await res.json();
      if (res.status === 401) {
        router.push("/signup");
        return;
      }
      if (data.error === "already_subscribed") {
        setError("You already have an active subscription.");
      } else if (data.url) {
        window.location.href = data.url;
        return;
      } else {
        setError("Couldn't start checkout — please try again.");
      }
    } catch {
      setError("Couldn't start checkout — please try again.");
    }
    setLoading(false);
  }

  return (
    <div>
      <button
        onClick={checkout}
        disabled={loading}
        className={
          highlight
            ? "flex w-full items-center justify-center gap-2 rounded-xl bg-[#7C9A92] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#6D8C7D] disabled:opacity-70"
            : "flex w-full items-center justify-center gap-2 rounded-xl border border-[#E5E1DA] bg-white px-4 py-3 text-sm font-medium text-[#1F2937] transition hover:border-[#7C9A92]/50 disabled:opacity-70"
        }
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {label}
      </button>
      {error && <p className="mt-2 text-xs text-[#991B1B]">{error}</p>}
    </div>
  );
}
