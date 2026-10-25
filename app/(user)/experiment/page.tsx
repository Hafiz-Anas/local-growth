import type { Metadata } from "next";
import { ExperimentView } from "@/components/experiment/experiment-view";
import { requireFeature } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Best posting times" };

export default async function ExperimentPage() {
  // Responds with the not-found page when the feature is OFF for this business.
  await requireFeature("experiment");
  return <ExperimentView />;
}
