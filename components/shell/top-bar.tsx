"use client";

import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";
import { ActiveAccountSwitcher } from "@/components/layout/login-switcher";
import { useActiveClient } from "@/components/providers/active-client-provider";
import { ConnectionPill } from "@/components/shared/connection-pill";
import { SITE } from "@/config/site";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { HeaderActions } from "./header-actions";
import { HOME_HREF } from "@/config/navigation";

/**
 * The client header, Instagram-style like the rest of the platform: the active account (switches between
 * the logins on this device), the Instagram connection status, the bell and the profile menu.
 */
export function TopBar({ className }: { className?: string }) {
  const { client, isPreview } = useActiveClient();
  const { locale } = useI18n();

  return (
    <header className={cn("sticky top-0 z-30 h-(--topbar-height) border-b border-border bg-background", className)}>
      <div className="mx-auto flex h-full max-w-(--content-max-width) items-center gap-3 px-4 md:px-8">
        <Link href={HOME_HREF} className="lg:hidden" aria-label={SITE.name}>
          <LogoMark className="size-7" />
        </Link>
        <ActiveAccountSwitcher
          readOnly={isPreview}
          current={{
            handle: client.instagramHandle ?? null,
            name: locale === "ar" ? client.businessNameAr : client.businessName,
            avatarUrl: client.avatarUrl,
            avatarInitials: client.avatarInitials,
            avatarTone: client.avatarTone,
          }}
        />

        <div className="ms-auto flex items-center gap-1 sm:gap-2">
          {/* Only the Instagram connection here; plan, language and appearance are in the profile menu. */}
          <ConnectionPill status={client.connection} withIcon />
          <HeaderActions />
        </div>
      </div>
    </header>
  );
}
