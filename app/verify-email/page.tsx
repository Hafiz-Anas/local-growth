import type { Metadata } from "next";
import { VerifyEmailResult } from "@/components/auth/verify-email-result";
import { getSession } from "@/lib/auth/server";
import { verifyEmailToken } from "@/lib/server/email-verification";

export const metadata: Metadata = { title: "Verify your email" };

/**
 * Opened from the verification email. Confirms the address on load (the link
 * is single-use and only marks the address verified), whether or not the
 * person is signed in on this device.
 */
export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  const { token } = await searchParams;
  const result = typeof token === "string" ? await verifyEmailToken(token) : "invalid";
  const session = await getSession();
  return <VerifyEmailResult result={result} signedIn={Boolean(session)} />;
}
