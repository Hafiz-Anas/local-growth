"use client";

import type { ReactNode } from "react";
import { useFeature } from "@/components/providers/active-client-provider";
import type { FeatureKey } from "@/types";

/**
 * Renders children only when the feature is ON. OFF features are removed, never grayed out.
 * Whole routes are gated on the server with `requireFeature()` (lib/auth/server.ts).
 */
export function Feature({ flag, children }: { flag: FeatureKey; children: ReactNode }) {
  return useFeature(flag) ? <>{children}</> : null;
}
