"use client";

import { createContext, useContext, type ReactNode } from "react";
import { isFeatureEnabled } from "@/lib/permissions";
import type { Client, FeatureKey, Permissions } from "@/types";

interface ActiveClientValue {
  client: Client;
  /** Effective permissions resolved on the server (session or database). */
  permissions: Permissions;
  isPreview: boolean;
}

const ActiveClientContext = createContext<ActiveClientValue | null>(null);

/**
 * The business account the user-facing screens are showing (own account, or the
 * one an admin previews). Rendered by the server layout, so after a change to
 * the business itself (photo, Instagram connection) call `router.refresh()`.
 */
export function ActiveClientProvider({ client, permissions, isPreview, children }: ActiveClientValue & { children: ReactNode }) {
  return <ActiveClientContext.Provider value={{ client, permissions, isPreview }}>{children}</ActiveClientContext.Provider>;
}

export function useActiveClient() {
  const ctx = useContext(ActiveClientContext);
  if (!ctx) throw new Error("useActiveClient must be used inside <ActiveClientProvider>");
  return ctx;
}

/** `true` only when the feature (plus its module) is ON. */
export function useFeature(key: FeatureKey): boolean {
  const { permissions } = useActiveClient();
  return isFeatureEnabled(permissions, key);
}
