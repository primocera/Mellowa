import type { Metadata } from "next";
import { AuthForm } from "@/components/forms/auth-form";

export const metadata: Metadata = { title: "Sign up — Mellowa" };

export default function SignupPage() {
  return <AuthForm mode="signup" />;
}
