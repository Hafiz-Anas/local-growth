import type { Metadata } from "next";
import { InsightsOverviewView } from "@/components/insights/overview-view";
import { requireFeature } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Insights" };

export default async function InsightsOverviewPage() {
  // Built on the post insights; the not-found page when they're off (Insights then opens on its next tab).
  await requireFeature("postInsights");
  return <InsightsOverviewView />;
}
