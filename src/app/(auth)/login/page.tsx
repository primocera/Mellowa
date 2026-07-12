import type { Metadata } from "next";
import { AuthForm } from "@/components/forms/auth-form";

export const metadata: Metadata = { title: "Log in — Mellowa" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  const { reset } = await searchParams;

  return (
    <div className="space-y-4">
      {reset === "success" && (
        <div className="rounded-xl bg-[#DCFCE7] px-4 py-3 text-sm text-[#166534]">
          Your password has been updated. You can log in now.
        </div>
      )}
      <AuthForm mode="login" />
    </div>
  );
}
