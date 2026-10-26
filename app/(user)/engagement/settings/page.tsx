import type { Metadata } from "next";
import { ReplySettingsView } from "@/components/engagement/engagement-view";
import { requireFeature } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Reply settings" };

export default async function ReplySettingsPage() {
  await requireFeature("engagement.aiReplies");
  return <ReplySettingsView />;
}
