import type { Metadata } from "next";
import { PostGeneratorView } from "@/components/post-generator/post-generator-view";
import { requireFeature } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Post Generator" };

export default async function PostGeneratorPage() {
  // Responds with the not-found page when the feature is OFF for this business.
  await requireFeature("postGenerator");
  return <PostGeneratorView />;
}
