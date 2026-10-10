"use client";

import { usePathname } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { MetaConnectButton, usePermissionNames } from "@/components/instagram/meta-connect";
import { useI18n } from "@/lib/i18n/provider";
import type { Client } from "@/types";

/**
 * Meta connections only: the token expired or was revoked ("Reconnect
 * Instagram"), or permissions are missing (reconnect and allow them).
 */
export function InstagramIssueBanner({ issue }: { issue: NonNullable<Client["instagramIssue"]> }) {
  const { t } = useI18n();
  const names = usePermissionNames();
  const pathname = usePathname();
  const reconnect = issue.reason === "reconnect";
  // Settings shows the same notice inside the Instagram card.
  if (pathname === "/settings" && !reconnect) return null;

  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-danger/8 px-4 py-2 text-caption md:px-8">
      <AlertTriangle className="size-4 shrink-0 text-danger" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">{reconnect ? t("instagramConnect.banner.reconnectTitle") : t("instagramConnect.banner.permissionsTitle")}</span>{" "}
        {reconnect ? t("instagramConnect.banner.reconnectBody") : t("instagramConnect.banner.permissionsBody", { list: names(issue.permissions) })}
      </p>
      <MetaConnectButton returnTo="settings" rerequest={!reconnect} size="sm" label={t("instagramConnect.banner.action")} className="h-7 px-3 text-caption" />
    </div>
  );
}
