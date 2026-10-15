import type { Metadata } from "next";
import { MethodsView } from "@/components/analysis/methods-view";
import { requireFeature } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Marketing methods" };

export default async function MethodsPage() {
  await requireFeature("methods");
  return <MethodsView />;
}
