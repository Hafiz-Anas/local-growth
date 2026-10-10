import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  // With the console email service the link is printed in the server log — say so in development.
  const showDevHint = process.env.NODE_ENV !== "production" && (process.env.EMAIL_PROVIDER ?? "console") === "console";
  return <ForgotPasswordForm showDevHint={showDevHint} />;
}
