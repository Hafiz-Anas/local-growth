import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
import { DEMO_ACCOUNTS, demoAccountsEnabled } from "@/config/demo";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // Set by the API client when a request comes back 401 (expired or revoked session).
  const { expired, add } = await searchParams;
  // ?add=1: "Add account" from the account switcher while signed in (proxy.ts lets clients through).
  return <LoginForm demoAccounts={demoAccountsEnabled() ? DEMO_ACCOUNTS : []} sessionExpired={expired === "1"} adding={add === "1"} />;
}
