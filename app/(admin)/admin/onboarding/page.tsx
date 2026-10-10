import type { Metadata } from "next";
import { OnboardingAdminView } from "@/components/admin/onboarding-view";

export const metadata: Metadata = { title: "Admin · Onboarding" };

export default function AdminOnboardingPage() {
  return <OnboardingAdminView />;
}
