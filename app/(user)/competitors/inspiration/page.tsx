import type { Metadata } from "next";
import { InspirationView } from "@/components/competitors/inspiration-view";
import { requireFeature } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Inspiration" };

export default async function CompetitorInspirationPage() {
  // Responds with the not-found page when the feature (or the competitors module) is OFF.
  await requireFeature("competitors.inspiration");
  return <InspirationView />;
}
