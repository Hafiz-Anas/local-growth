import type { Metadata } from "next";
import { OnboardingWizard } from "@/components/onboarding/wizard";
import { requireSession } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Set up your business" };

export default async function OnboardingPage() {
  const session = await requireSession();
  return <OnboardingWizard userName={session.name} />;
}
