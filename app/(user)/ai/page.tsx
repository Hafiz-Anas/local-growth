import type { Metadata } from "next";
import { AiScreen } from "@/components/ai-chat/ai-screen";
import { requireFeature } from "@/lib/auth/server";

export const metadata: Metadata = { title: "AI" };

export default async function AiPage() {
  // Responds with the not-found page when the feature is OFF for this business.
  await requireFeature("aiChat");
  return <AiScreen />;
}
