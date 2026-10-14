import type { Metadata } from "next";
import { RecommendationsView } from "@/components/recommendations/recommendations-view";
import { requireFeature } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Recommendations" };

export default async function RecommendationsPage() {
  // Responds with the not-found page when the feature is OFF for this business.
  await requireFeature("recommendations");
  return <RecommendationsView />;
}
