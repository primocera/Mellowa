"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Values = { password: string; confirm: string };

export function ResetPasswordForm() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [linkValid, setLinkValid] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<Values>();

  // Supabase sets a recovery session from the URL on load. If there's no
  // session, the link is invalid or expired.
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      setLinkValid(!!data.session);
      setReady(true);
    });
  }, []);

  async function onSubmit({ password }: Values) {
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    router.push("/login?reset=success");
  }

  if (!ready) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-6 w-6 animate-spin text-[#7C9A92]" />
      </div>
    );
  }

  if (!linkValid) {
    return (
      <div className="text-center">
        <h2 className="text-lg font-semibold text-[#1F2937]">
          This reset link has expired
        </h2>
        <p className="mt-2 text-sm text-[#6B7280]">
          Reset links are only valid for a short time. Request a new one to
          continue.
        </p>
        <Link
          href="/forgot-password"
          className="mt-6 inline-block rounded-xl bg-[#7C9A92] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#6D8C7D]"
        >
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-[#1F2937]">Set a new password</h2>
        <p className="mt-1 text-sm text-[#6B7280]">
          Choose a new password to get back to your daily routine.
        </p>
      </div>

      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium text-[#1F2937]">
          New password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          className="w-full rounded-xl border border-[#E5E1DA] bg-white px-4 py-3 text-[#1F2937] outline-none transition focus:border-[#7C9A92] focus:ring-2 focus:ring-[#7C9A92]/20"
          placeholder="••••••••"
          {...register("password", {
            required: "Password is required",
            minLength: { value: 8, message: "At least 8 characters" },
          })}
        />
        {errors.password && (
          <p className="mt-1 text-sm text-red-500">{errors.password.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="confirm" className="mb-1 block text-sm font-medium text-[#1F2937]">
          Confirm password
        </label>
        <input
          id="confirm"
          type="password"
          autoComplete="new-password"
          className="w-full rounded-xl border border-[#E5E1DA] bg-white px-4 py-3 text-[#1F2937] outline-none transition focus:border-[#7C9A92] focus:ring-2 focus:ring-[#7C9A92]/20"
          placeholder="••••••••"
          {...register("confirm", {
            required: "Please confirm your password",
            validate: (v) => v === getValues("password") || "Passwords don't match",
          })}
        />
        {errors.confirm && (
          <p className="mt-1 text-sm text-red-500">{errors.confirm.message}</p>
        )}
      </div>

      {error && (
        <div className="rounded-xl bg-[#FEE2E2] px-4 py-3 text-sm text-[#991B1B]">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#7C9A92] px-4 py-3 font-medium text-white transition hover:bg-[#6D8C7D] disabled:opacity-60"
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        Update password
      </button>
    </form>
  );
}
