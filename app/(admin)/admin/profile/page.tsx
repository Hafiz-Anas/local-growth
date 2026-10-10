import type { Metadata } from "next";
import { AdminProfileView } from "@/components/admin/profile-view";
import { requireAdmin } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Admin · Profile" };

/** The admin's own account (top-right menu → Profile): photo, password, language and appearance. */
export default async function AdminProfilePage() {
  const session = await requireAdmin();
  return <AdminProfileView account={{ name: session.name, email: session.email, avatarUrl: session.avatarUrl }} />;
}
