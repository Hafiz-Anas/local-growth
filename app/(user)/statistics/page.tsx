import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StatisticsView } from "@/components/statistics/statistics-view";
import { SHOW_STATISTICS } from "@/config/insights";
import { USER_NAV } from "@/config/navigation";
import { getActiveClientContext, requireFeature } from "@/lib/auth/server";
import { filterNav } from "@/lib/permissions";

export const metadata: Metadata = { title: "Statistics" };

export default async function StatisticsPage() {
  if (!SHOW_STATISTICS) {
    // The tab is turned off (config/insights.ts): old links land on Insights' first page (Post performance,
    // which has its "What works best" card), or Home when the client has no Insights page.
    const { permissions } = await getActiveClientContext();
    redirect(filterNav(USER_NAV, permissions).find((item) => item.labelKey === "nav.insights")?.href ?? "/gallery");
  }
  await requireFeature("statistics");
  return <StatisticsView />;
}
