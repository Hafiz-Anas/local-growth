import type { Metadata } from "next";
import { ReportsView } from "@/components/reports/reports-view";
import { requireFeature } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Weekly reports" };

export default async function ReportsPage() {
  // Responds with the not-found page when the feature is OFF for this business.
  await requireFeature("reports");
  return <ReportsView />;
}
