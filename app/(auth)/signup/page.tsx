import type { Metadata } from "next";
import { SignupForm } from "@/components/auth/signup-form";
import { signupPageState } from "@/lib/server/signup";
import { SIGNUP_PAGE_OUTCOMES, type SignupFailure } from "@/lib/signup-flow";

export const metadata: Metadata = { title: "Sign up" };

/**
 * Sign-up, one page: email, password, "Continue with Instagram" (lib/server/signup.ts). Instagram's callback
 * comes back here with ?instagram=<outcome> when no account was created; this browser's pending sign-up
 * fills the email in again and holds the choices when one Facebook login found several accounts.
 */
export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const params = await searchParams;
  const raw = typeof params.instagram === "string" ? params.instagram : null;
  const outcome = SIGNUP_PAGE_OUTCOMES.includes(raw as SignupFailure) ? (raw as SignupFailure | "pick") : null;
  const pending = await signupPageState();
  // ?add=1: "Add account" → "Create a new account" while signed in (proxy.ts lets clients through).
  return <SignupForm adding={params.add === "1"} initialEmail={pending.email} outcome={outcome} picking={pending.picking} />;
}
