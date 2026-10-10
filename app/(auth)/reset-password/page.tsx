import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { isResetTokenValid } from "@/lib/server/password-reset";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const { token } = await searchParams;
  const value = typeof token === "string" ? token : "";
  // Checked up front so an expired or used link says so immediately.
  const valid = value.length > 0 && (await isResetTokenValid(value));
  return <ResetPasswordForm token={value} valid={valid} />;
}
