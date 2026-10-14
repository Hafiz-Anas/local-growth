import type { Metadata } from "next";
import { AssistantView } from "@/components/assistant/assistant-view";
import { requireFeature } from "@/lib/auth/server";

export const metadata: Metadata = { title: "AI Assistant" };

export default async function AssistantPage() {
  // Responds with the not-found page when the feature is OFF for this business.
  await requireFeature("assistant");
  return <AssistantView />;
}
