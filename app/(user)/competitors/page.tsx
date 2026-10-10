import type { Metadata } from "next";
import { CompetitorsView } from "@/components/competitors/competitors-view";
import { requireFeature } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Competitor Insights" };

export default async function CompetitorsPage() {
  // Responds with the not-found page when the feature is OFF for this business.
  await requireFeature("competitors");
  return <CompetitorsView />;
}
