import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GalleryScreen } from "@/components/gallery/gallery-screen";
import { USER_NAV } from "@/config/navigation";
import { getActiveClientContext } from "@/lib/auth/server";
import { clientHome } from "@/lib/navigation";
import { filterNav, isFeatureEnabled } from "@/lib/permissions";

export const metadata: Metadata = { title: "Gallery" };

/**
 * The landing page after logging in and after onboarding (HOME_BY_ROLE.user). Gallery is front-end
 * only, on mock data (components/gallery, mock-data/gallery). When the module is off, clients land on
 * their first section instead of a 404.
 */
export default async function GalleryPage() {
  const { permissions } = await getActiveClientContext();
  if (!isFeatureEnabled(permissions, "gallery")) redirect(clientHome(filterNav(USER_NAV, permissions)));
  return <GalleryScreen />;
}
