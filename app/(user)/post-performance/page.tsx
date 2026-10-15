import type { Metadata } from "next";
import { PostPerformanceView } from "@/components/analysis/post-performance-view";
import { requireFeature } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Post performance" };

export default async function PostPerformancePage() {
  await requireFeature("postInsights");
  return <PostPerformanceView />;
}
