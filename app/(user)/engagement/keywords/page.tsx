import type { Metadata } from "next";
import { KeywordRepliesView } from "@/components/engagement/engagement-view";
import { requireFeature } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Keyword replies" };

export default async function KeywordRepliesPage() {
  await requireFeature("engagement.dmRules");
  return <KeywordRepliesView />;
}
