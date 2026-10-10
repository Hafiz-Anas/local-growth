import type { Metadata } from "next";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  // Set when the onboarding wizard finishes.
  const { welcome } = await searchParams;
  return <DashboardView welcome={welcome === "1"} />;
}
