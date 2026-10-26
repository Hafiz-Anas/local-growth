import { notFound, redirect } from "next/navigation";
import { USER_NAV } from "@/config/navigation";
import { requireFeature } from "@/lib/auth/server";
import { filterNav } from "@/lib/permissions";

/**
 * Engagement is split into tabs (Comment replies · DM replies · Keyword replies · Reply settings).
 * Old links to /engagement (the dashboard tile, "replies waiting" notifications) land on the first
 * tab the client has.
 */
export default async function EngagementPage() {
  const { permissions } = await requireFeature("engagement");
  const section = filterNav(USER_NAV, permissions).find((item) => item.labelKey === "nav.engagement");
  if (!section) notFound();
  redirect(section.href);
}
