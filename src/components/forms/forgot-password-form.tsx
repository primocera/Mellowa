"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { Loader2, MailCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Values = { email: string };

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>();

  async function onSubmit({ email }: Values) {
    setLoading(true);
    const supabase = createClient();
    // Deliberately ignore the result so we never reveal whether an account
    // exists (no user enumeration).
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSent(true);
    setLoading(false);
  }

  if (sent) {
    return (
      <div className="text-center">
        <MailCheck className="mx-auto h-10 w-10 text-[#7C9A92]" />
        <h2 className="mt-4 text-lg font-semibold text-[#1F2937]">
          Check your email
        </h2>
        <p className="mt-2 text-sm text-[#6B7280]">
          If an account exists, we sent a reset link to your email. It may take a
          minute to arrive.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-block text-sm font-medium text-[#7C9A92] hover:underline"
        >
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-[#1F2937]">
          Forgot your password?
        </h2>
        <p className="mt-1 text-sm text-[#6B7280]">
          Enter your email and we&apos;ll send you a reset link.
        </p>
      </div>

      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium text-[#1F2937]">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          className="w-full rounded-xl border border-[#E5E1DA] bg-white px-4 py-3 text-[#1F2937] outline-none transition focus:border-[#7C9A92] focus:ring-2 focus:ring-[#7C9A92]/20"
          placeholder="you@example.com"
          {...register("email", { required: "Email is required" })}
        />
        {errors.email && (
          <p className="mt-1 text-sm text-red-500">{errors.email.message}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#7C9A92] px-4 py-3 font-medium text-white transition hover:bg-[#6D8C7D] disabled:opacity-60"
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        Send reset link
      </button>

      <p className="text-center text-sm text-[#6B7280]">
        <Link href="/login" className="font-medium text-[#7C9A92] hover:underline">
          Back to log in
        </Link>
      </p>
    </form>
  );
}
