import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ConnectInstagram } from "@/components/auth/connect-instagram";
import { PreferencesSync } from "@/components/providers/preferences-sync";
import { requireSession } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { setupSwitcherAccount } from "@/lib/server/accounts";
import { getUiPreferences } from "@/lib/server/client-view";
import { verificationBannerEnabled } from "@/lib/server/email-verification";
import { getConnectionDto } from "@/lib/server/instagram-account";
import { needsInstagramConnection } from "@/lib/server/onboarding";
import { connectFlow } from "@/lib/services/meta/config";

export const metadata: Metadata = { title: "Connect Instagram" };

/**
 * Sign-up, step 2 of 2: connect Instagram (it names the business). A business that signed up but never
 * connected is sent back here from every page until it does; once connected, on to the wizard.
 */
export default async function ConnectInstagramPage({ searchParams }: PageProps<"/signup/instagram">) {
  const session = await requireSession();
  if (session.role === "admin") redirect("/admin");
  if (!session.businessId) redirect("/login");
  const params = await searchParams;
  if (!(await needsInstagramConnection(session.businessId))) redirect(params.instagram === "connected" ? "/onboarding?instagram=connected" : "/onboarding");

  const [user, connection, account, preferences, source] = await Promise.all([
    db.user.findUnique({ where: { id: session.userId }, select: { email: true, emailVerifiedAt: true } }),
    getConnectionDto(session.businessId),
    setupSwitcherAccount(session.userId, session.businessId),
    getUiPreferences(session.userId),
    db.business.findUnique({ where: { id: session.businessId }, select: { source: true } }),
  ]);
  return (
    <>
      <PreferencesSync saved={preferences} />
      <ConnectInstagram
        flow={connectFlow()}
        connection={connection}
        account={account}
        addedAccount={source?.source === "ACCOUNT_ADDED"}
        email={user?.email ?? session.email}
        emailUnverified={verificationBannerEnabled() && Boolean(user && !user.emailVerifiedAt)}
        verificationUnsent={params.verification === "unsent"}
        userName={session.name}
      />
    </>
  );
}
