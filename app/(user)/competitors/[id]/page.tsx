import type { Metadata } from "next";
import { CompetitorDetailView } from "@/components/competitors/competitor-detail-view";
import { requireFeature } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Competitor" };

export default async function CompetitorDetailPage({ params }: PageProps<"/competitors/[id]">) {
  // Same gate as the tracked-accounts grid: not-found page when the feature is OFF.
  await requireFeature("competitors.accounts");
  const { id } = await params;
  return <CompetitorDetailView id={id} />;
}
