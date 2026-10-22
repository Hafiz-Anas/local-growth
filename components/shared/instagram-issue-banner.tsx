"use client";

import { AlertTriangle } from "lucide-react";
import { MetaConnectButton } from "@/components/instagram/meta-connect";
import { useI18n } from "@/lib/i18n/provider";

/**
 * Meta connections only: the token expired or was revoked ("Reconnect Instagram").
 * Missing permissions aren't a banner: Settings shows a small "Permissions missing" tag.
 */
export function InstagramIssueBanner() {
  const { t } = useI18n();
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-danger/8 px-4 py-2 text-caption md:px-8">
      <AlertTriangle className="size-4 shrink-0 text-danger" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">{t("instagramConnect.banner.reconnectTitle")}</span> {t("instagramConnect.banner.reconnectBody")}
      </p>
      <MetaConnectButton returnTo="settings" size="sm" label={t("instagramConnect.banner.action")} className="h-7 px-3 text-caption" />
    </div>
  );
}
