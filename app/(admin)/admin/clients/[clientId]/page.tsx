import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClientPermissionsView } from "@/components/admin/client-permissions-view";
import { db } from "@/lib/db";
import { idSchema } from "@/lib/server/http";

export const metadata: Metadata = { title: "Admin · Client" };

export default async function ClientPermissionsPage({ params }: PageProps<"/admin/clients/[clientId]">) {
  const { clientId } = await params;
  // Unknown (or just-deleted) businesses get the not-found page.
  if (!idSchema.safeParse(clientId).success || !(await db.business.count({ where: { id: clientId } }))) notFound();
  return <ClientPermissionsView clientId={clientId} />;
}
