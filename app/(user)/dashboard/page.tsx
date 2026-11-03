import { redirect } from "next/navigation";
import { USER_NAV } from "@/config/navigation";
import { getActiveClientContext } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { startPageHref } from "@/lib/navigation";
import { filterNav } from "@/lib/permissions";
import { uiPreferencesSchema } from "@/lib/validation/api";

/**
 * The client's start page (UX1): where logging in, "/", switching accounts and finishing onboarding land, and old
 * links to the removed Home. The section the user picked in Settings → Preferences when the business still has
 * it, else the Gallery (or the first section left). Admin preview always opens on the usual home.
 */
export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const { permissions, session, isPreview } = await getActiveClientContext();
  const query = new URLSearchParams(Object.entries(await searchParams).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
  const user = isPreview ? null : await db.user.findUnique({ where: { id: session.userId }, select: { uiPreferences: true } });
  const startPage = user ? uiPreferencesSchema.catch(uiPreferencesSchema.parse({})).parse(user.uiPreferences ?? {}).startPage : null;
  const home = startPageHref(filterNav(USER_NAV, permissions), startPage);
  redirect(query.size ? `${home}?${query}` : home);
}
