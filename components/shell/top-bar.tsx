"use client";

import { ActiveAccountSwitcher } from "@/components/layout/login-switcher";
import { useActiveClient } from "@/components/providers/active-client-provider";
import { cn } from "@/lib/gallery/utils";
import { useI18n } from "@/lib/i18n/provider";
import { HeaderActions } from "./header-actions";

/** The design proposal's header: the active @handle (switches between the logins on this device), the bell and the profile picture. */
export function TopBar({ className }: { className?: string }) {
  const { client, isPreview } = useActiveClient();
  const { locale } = useI18n();

  return (
    <header className={cn("ge sticky top-0 z-30 border-b border-transparent bg-ge-background/85 pt-safe backdrop-blur-xl supports-[backdrop-filter]:bg-ge-background/75", className)}>
      <div className="mx-auto flex h-14 max-w-[935px] items-center gap-1 ps-2.5 pe-2 lg:px-8">
        <ActiveAccountSwitcher
          look="proposal"
          readOnly={isPreview}
          current={{
            handle: client.instagramHandle ?? null,
            name: locale === "ar" ? client.businessNameAr : client.businessName,
            avatarUrl: client.avatarUrl,
            avatarInitials: client.avatarInitials,
            avatarTone: client.avatarTone,
          }}
        />
        <div className="flex-1" />
        <HeaderActions />
      </div>
    </header>
  );
}
