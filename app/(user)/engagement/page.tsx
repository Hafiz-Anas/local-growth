import type { Metadata } from "next";
import { EngagementView } from "@/components/engagement/engagement-view";
import { requireFeature } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Engagement" };

export default async function EngagementPage() {
  // Responds with the not-found page when the feature is OFF for this business.
  await requireFeature("engagement");
  return <EngagementView />;
}
