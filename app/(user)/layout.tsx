import { redirect } from "next/navigation";
import { UserShell } from "@/components/layout/user-shell";
import { ActiveClientProvider } from "@/components/providers/active-client-provider";
import { USER_NAV } from "@/config/navigation";
import { getActiveClientContext } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { filterNav } from "@/lib/permissions";
import { getClientView, getUiPreferences } from "@/lib/server/client-view";
import { verificationBannerEnabled } from "@/lib/server/email-verification";
import { ACCOUNT_META } from "@/lib/api/client";
import { initials, toneFor } from "@/lib/utils";

export default async function UserLayout({ children }: LayoutProps<"/">) {
  const { session, clientId, isPreview, permissions } = await getActiveClientContext();

  // Until onboarding is finished the wizard is the only screen — unless the owner chose "Finish later"
  // (the dashboard then links back to it). Admins previewing see the app as is.
  const [business, user] = await Promise.all([
    db.business.findUnique({ where: { id: clientId }, select: { onboardingStatus: true, onboardingDeferredAt: true } }),
    isPreview ? null : db.user.findUnique({ where: { id: session.userId }, select: { emailVerifiedAt: true } }),
  ]);
  if (!isPreview && business?.onboardingStatus === "IN_PROGRESS" && !business.onboardingDeferredAt) redirect("/onboarding");

  const [client, preferences] = await Promise.all([getClientView(clientId), getUiPreferences(session.userId)]);
  if (!client) redirect(session.role === "admin" ? "/admin" : "/login");

  // The profile row belongs to whoever is signed in (the admin while previewing): the person,
  // not the Instagram account — it stays the same when switching accounts.
  const menuUser = {
    name: session.name,
    email: session.email,
    avatarUrl: session.avatarUrl,
    initials: initials(session.name),
    tone: isPreview ? ("night" as const) : toneFor(session.userId),
    role: session.role,
  };

  // Navigation is built here, on the server, from the enabled features only.
  const nav = filterNav(USER_NAV, permissions);

  return (
    <ActiveClientProvider client={client} permissions={permissions} isPreview={isPreview}>
      {/* The account this page shows; apiFetch sends it so a stale tab can't change another account. */}
      {!isPreview && <meta name={ACCOUNT_META} content={clientId} />}
      <UserShell user={menuUser} nav={nav} preferences={preferences} emailUnverified={verificationBannerEnabled() && Boolean(user && !user.emailVerifiedAt)}>
        {children}
      </UserShell>
    </ActiveClientProvider>
  );
}
