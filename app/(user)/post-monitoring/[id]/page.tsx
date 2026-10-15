import type { Metadata } from "next";
import { MonitorDetailView } from "@/components/monitoring/monitor-detail-view";
import { requireFeature } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Post monitoring" };

export default async function MonitorDetailPage({ params }: PageProps<"/post-monitoring/[id]">) {
  await requireFeature("monitoring");
  const { id } = await params;
  return <MonitorDetailView id={decodeURIComponent(id)} />;
}
