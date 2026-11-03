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
    // The tab is turned off (config/insights.ts): old links land on Post performance (it has the
    // "What works best" card), else Insights' first page, or Home when the client has no Insights page.
    const { permissions } = await getActiveClientContext();
    const insights = filterNav(USER_NAV, permissions).find((item) => item.labelKey === "nav.insights");
    redirect(insights?.pages?.find((p) => p.href === "/post-performance")?.href ?? insights?.href ?? "/gallery");
  }
  await requireFeature("statistics");
  return <StatisticsView />;
}
