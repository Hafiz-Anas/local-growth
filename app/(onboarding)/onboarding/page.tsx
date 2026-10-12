import type { Metadata } from "next";
import { OnboardingWizard } from "@/components/onboarding/wizard";
import { requireSession } from "@/lib/auth/server";
import { verificationBannerEnabled } from "@/lib/server/email-verification";

export const metadata: Metadata = { title: "Set up your business" };

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const session = await requireSession();
  // Set by sign-up when the verification email could not be sent.
  const verificationUnsent = (await searchParams).verification === "unsent";
  return <OnboardingWizard userName={session.name} verificationUnsent={verificationUnsent} showVerifyBanner={verificationBannerEnabled()} />;
}
