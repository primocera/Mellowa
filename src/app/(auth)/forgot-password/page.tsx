import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/forms/forgot-password-form";

export const metadata: Metadata = { title: "Reset password — Mellowa" };

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
