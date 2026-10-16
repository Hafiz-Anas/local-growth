import type { Metadata } from "next";
import { OnboardingWizard } from "@/components/onboarding/wizard";
import { requireSession } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { verificationBannerEnabled } from "@/lib/server/email-verification";
import { initials, toneFor } from "@/lib/utils";

export const metadata: Metadata = { title: "Set up your business" };

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const session = await requireSession();
  // Set by sign-up when the verification email could not be sent.
  const verificationUnsent = (await searchParams).verification === "unsent";
  // A login with other Instagram accounts gets the account switcher in the wizard (the layout checked the business).
  const businessId = session.businessId;
  const [business, accounts] = businessId
    ? await Promise.all([
        db.business.findUnique({ where: { id: businessId }, select: { name: true, instagramHandle: true, avatarUrl: true } }),
        db.businessMember.count({ where: { userId: session.userId } }),
      ])
    : [null, 0];
  const account =
    businessId && business && accounts > 1
      ? {
          handle: business.instagramHandle,
          name: business.name,
          avatarUrl: business.avatarUrl,
          avatarInitials: initials(business.name || business.instagramHandle || "IG"),
          avatarTone: toneFor(business.instagramHandle ?? businessId),
        }
      : undefined;
  return <OnboardingWizard userName={session.name} verificationUnsent={verificationUnsent} showVerifyBanner={verificationBannerEnabled()} account={account} />;
}
