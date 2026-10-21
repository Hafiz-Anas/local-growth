import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { DemoInstagram } from "@/components/auth/demo-instagram";
import { connectFlow } from "@/lib/services/meta/config";
import { isSignupState } from "@/lib/signup-flow";

export const metadata: Metadata = { title: "Connect Instagram" };

/**
 * Sign-up's stand-in for Facebook Login while INSTAGRAM_PROVIDER=mock (lib/server/signup.ts sends the
 * browser here instead of Meta). Doesn't exist with the real Meta flow.
 */
export default async function DemoInstagramPage({ searchParams }: PageProps<"/signup/demo-instagram">) {
  if (connectFlow() !== "mock") notFound();
  const { state } = await searchParams;
  if (typeof state !== "string" || !isSignupState(state)) redirect("/signup");
  return <DemoInstagram state={state} />;
}
