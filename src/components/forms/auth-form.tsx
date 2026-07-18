"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  resolveDestination,
  serializeIntent,
  type PlanIntent,
} from "@/lib/auth/intent";

type AuthValues = {
  email: string;
  password: string;
  age18: boolean;
  policies: boolean;
};

export function AuthForm({
  mode,
  plan = null,
  next = null,
}: {
  mode: "login" | "signup";
  plan?: PlanIntent | null;
  next?: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AuthValues>();

  const isLogin = mode === "login";

  // Map provider errors to safe, non-enumerating customer copy — raw
  // Supabase strings are never shown (CE v6, Prompt 5).
  function safeAuthError(message: string): string {
    if (/invalid login credentials/i.test(message)) {
      return "That email and password combination didn't work. Try again or reset your password.";
    }
    if (/rate limit|too many/i.test(message)) {
      return "Too many attempts just now. Wait a minute and try again.";
    }
    if (/password/i.test(message) && /short|weak|at least/i.test(message)) {
      return "Please use a longer password — at least 8 characters.";
    }
    return "That didn't go through. Please try again.";
  }

  async function onSubmit(values: AuthValues) {
    setError(null);
    setLoading(true);
    const supabase = createClient();

    const intentQuery = serializeIntent({ plan, next });

    if (isLogin) {
      const { error } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password,
      });
      if (error) {
        setError(safeAuthError(error.message));
        setLoading(false);
        return;
      }
      router.push(resolveDestination({ plan, next }));
      router.refresh();
      return;
    }

    // Signup: consents travel in user metadata; the auth callback records
    // them server-side after the email is verified. Never assume a live
    // session here — with email confirmation enabled there is none.
    const { data, error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback${intentQuery}`,
        data: { age_18_plus: true, terms_and_privacy: true },
      },
    });

    if (error) {
      // Non-enumerating: an already-registered address gets the same
      // verify-email screen as a new one instead of a revealing error.
      if (/already registered/i.test(error.message)) {
        router.push(
          `/verify-email${serializeIntent({ plan, next })}${intentQuery ? "&" : "?"}email=${encodeURIComponent(values.email)}`
        );
        return;
      }
      setError(safeAuthError(error.message));
      setLoading(false);
      return;
    }

    if (!data.session) {
      // Email confirmation is enabled — verification continues over email.
      router.push(
        `/verify-email${intentQuery}${intentQuery ? "&" : "?"}email=${encodeURIComponent(values.email)}`
      );
      return;
    }

    // Confirmation disabled (e.g. local dev): record consents and send the
    // welcome email directly, then continue to the destination.
    void fetch("/api/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ age_18_plus: true, terms_and_privacy: true }),
    }).catch(() => {});
    void fetch("/api/email/welcome", { method: "POST" }).catch(() => {});

    router.push(resolveDestination({ plan, next }));
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
        {!isLogin && !errors.password && (
          <p className="mt-1 text-sm text-[#6B7280]">Use at least 8 characters.</p>
        )}
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
