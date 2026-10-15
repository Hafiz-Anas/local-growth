import type { Metadata } from "next";
import { StatisticsView } from "@/components/statistics/statistics-view";
import { requireFeature } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Statistics" };

export default async function StatisticsPage() {
  await requireFeature("statistics");
  return <StatisticsView />;
}
