import type { Metadata } from "next";
import { CommentRepliesView } from "@/components/engagement/engagement-view";
import { requireFeature } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Comment replies" };

export default async function CommentRepliesPage() {
  await requireFeature("engagement.aiReplies");
  return <CommentRepliesView />;
}
