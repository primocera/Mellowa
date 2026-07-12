import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/forms/reset-password-form";

export const metadata: Metadata = { title: "Set a new password — Mellowa" };

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
