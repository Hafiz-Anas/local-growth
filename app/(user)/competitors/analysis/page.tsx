import type { Metadata } from "next";
import { CompetitorAnalysisView } from "@/components/analysis/competitor-analysis-view";
import { requireFeature } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Competitor analysis" };

export default async function CompetitorAnalysisPage() {
  // Responds with the not-found page when the feature (or the competitors module) is OFF.
  await requireFeature("competitors.analysis");
  return <CompetitorAnalysisView />;
}
