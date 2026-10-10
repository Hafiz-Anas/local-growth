import { redirect } from "next/navigation";
import { UserShell } from "@/components/layout/user-shell";
import { ActiveClientProvider } from "@/components/providers/active-client-provider";
import { USER_NAV } from "@/config/navigation";
import { getActiveClientContext } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { filterNav } from "@/lib/permissions";
import { getClientView, getUiPreferences } from "@/lib/server/client-view";
import { initials } from "@/lib/utils";

export default async function UserLayout({ children }: LayoutProps<"/">) {
  const { session, clientId, isPreview, permissions } = await getActiveClientContext();

  // Until onboarding is finished the wizard is the only screen (admins previewing see the app as is).
  const [business, user] = await Promise.all([
    db.business.findUnique({ where: { id: clientId }, select: { onboardingStatus: true } }),
    isPreview ? null : db.user.findUnique({ where: { id: session.userId }, select: { emailVerifiedAt: true } }),
  ]);
  if (!isPreview && business?.onboardingStatus === "IN_PROGRESS") redirect("/onboarding");

  const [client, preferences] = await Promise.all([getClientView(clientId), getUiPreferences(session.userId)]);
  if (!client) redirect(session.role === "admin" ? "/admin" : "/login");

  // The profile row belongs to whoever is signed in: the admin while previewing, else the user.
  const menuUser = {
    name: session.name,
    email: session.email,
    avatarUrl: session.avatarUrl,
    initials: isPreview ? initials(session.name) : client.avatarInitials,
    tone: isPreview ? ("night" as const) : client.avatarTone,
    role: session.role,
  };

  // Navigation is built here, on the server, from the enabled features only.
  const nav = filterNav(USER_NAV, permissions);

  return (
    <ActiveClientProvider client={client} permissions={permissions} isPreview={isPreview}>
      <UserShell user={menuUser} nav={nav} preferences={preferences} emailUnverified={Boolean(user && !user.emailVerifiedAt)}>
        {children}
      </UserShell>
    </ActiveClientProvider>
  );
}
