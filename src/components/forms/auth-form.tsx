"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type AuthValues = {
  email: string;
  password: string;
  age18: boolean;
  policies: boolean;
};

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AuthValues>();

  const isLogin = mode === "login";

  async function onSubmit(values: AuthValues) {
    setError(null);
    setLoading(true);
    const supabase = createClient();

    const { error } = isLogin
      ? await supabase.auth.signInWithPassword(values)
      : await supabase.auth.signUp(values);

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    if (!isLogin) {
      // Record the explicit age + policy consents (Prompt 6). If the session
      // isn't live yet (email confirmation flows), the in-app consent
      // checkpoint collects them before any generation instead.
      void fetch("/api/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ age_18_plus: true, terms_and_privacy: true }),
      }).catch(() => {});
      // Best-effort welcome email — never blocks the redirect.
      void fetch("/api/email/welcome", { method: "POST" }).catch(() => {});
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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

      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium text-[#1F2937]">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete={isLogin ? "current-password" : "new-password"}
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
        {isLogin && (
          <div className="mt-1.5 text-right">
            <Link
              href="/forgot-password"
              className="text-sm text-[#7C9A92] hover:underline"
            >
              Forgot password?
            </Link>
          </div>
        )}
      </div>

      {!isLogin && (
        <fieldset className="space-y-2.5">
          <legend className="sr-only">Required confirmations</legend>
          <label className="flex items-start gap-2.5 text-sm text-[#1F2937]">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-[#E5E1DA] accent-[#7C9A92]"
              {...register("age18", { required: "Please confirm you are 18 or older" })}
            />
            <span>I am at least 18 years old</span>
          </label>
          {errors.age18 && (
            <p className="text-sm text-red-500">{errors.age18.message}</p>
          )}
          <label className="flex items-start gap-2.5 text-sm text-[#1F2937]">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-[#E5E1DA] accent-[#7C9A92]"
              {...register("policies", {
                required: "Please accept the Terms and Privacy Policy",
              })}
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
          {errors.policies && (
            <p className="text-sm text-red-500">{errors.policies.message}</p>
          )}
        </fieldset>
      )}

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
        {isLogin ? "Log in" : "Create account"}
      </button>

      <p className="text-center text-sm text-[#6B7280]">
        {isLogin ? (
          <>
            New to Mellowa?{" "}
            <Link href="/signup" className="font-medium text-[#7C9A92] hover:underline">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-[#7C9A92] hover:underline">
              Log in
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
