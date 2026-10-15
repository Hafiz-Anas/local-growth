import type { Metadata } from "next";
import { PostMonitoringView } from "@/components/monitoring/post-monitoring-view";
import { requireFeature } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Post monitoring" };

export default async function PostMonitoringPage() {
  await requireFeature("monitoring");
  return <PostMonitoringView />;
}
