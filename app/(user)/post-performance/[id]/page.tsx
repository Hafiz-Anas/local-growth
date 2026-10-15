import type { Metadata } from "next";
import { PostDetailView } from "@/components/analysis/post-detail-view";
import { requireFeature } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Post performance" };

export default async function PostDetailPage({ params }: PageProps<"/post-performance/[id]">) {
  await requireFeature("postInsights");
  const { id } = await params;
  return <PostDetailView id={decodeURIComponent(id)} />;
}
