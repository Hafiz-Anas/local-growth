import type { Metadata } from "next";
import { SignupForm } from "@/components/auth/signup-form";

export const metadata: Metadata = { title: "Sign up" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  // ?add=1: "Add account" → "Create a new account" while signed in (proxy.ts lets clients through).
  return <SignupForm adding={(await searchParams).add === "1"} />;
}
