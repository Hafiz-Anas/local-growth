import type { Metadata } from "next";
import { DmRepliesView } from "@/components/engagement/engagement-view";
import { requireFeature } from "@/lib/auth/server";

export const metadata: Metadata = { title: "DM replies" };

export default async function DmRepliesPage() {
  await requireFeature("engagement.aiReplies");
  return <DmRepliesView />;
}
