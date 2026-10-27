import { redirect } from "next/navigation";
import { PreferencesSync } from "@/components/providers/preferences-sync";
import { requireSession } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { getUiPreferences } from "@/lib/server/client-view";
import { needsInstagramConnection } from "@/lib/server/onboarding";

/**
 * Full-screen wizard, outside the app shell (no sidebar). Only for business users who haven't finished,
 * and only once Instagram is connected (sign-up's second screen).
 */
export default async function OnboardingLayout({ children }: LayoutProps<"/onboarding">) {
  const session = await requireSession();
  if (session.role === "admin") redirect("/admin");
  if (!session.businessId) redirect("/login");
  const business = await db.business.findUnique({ where: { id: session.businessId }, select: { onboardingStatus: true } });
  if (!business) redirect("/login");
  if (await needsInstagramConnection(session.businessId)) redirect("/signup/instagram");
  if (business.onboardingStatus === "COMPLETED") redirect("/gallery");
  const preferences = await getUiPreferences(session.userId);
  return (
    <>
      <PreferencesSync saved={preferences} />
      {children}
    </>
  );
}
