import type { Metadata } from "next";
import { OnboardingWizard } from "@/components/onboarding/wizard";
import { requireSession } from "@/lib/auth/server";
import { setupSwitcherAccount } from "@/lib/server/accounts";

export const metadata: Metadata = { title: "Set up your business" };

export default async function OnboardingPage() {
  const session = await requireSession();
  // A login with other Instagram accounts gets the account switcher in the wizard (the layout checked the business).
  const account = await setupSwitcherAccount(session.userId, session.businessId);
  return <OnboardingWizard userName={session.name} account={account} />;
}
