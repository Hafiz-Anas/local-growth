"use client";

import type { ReactNode } from "react";
import { startTransition } from "react";
import Link from "next/link";
import { Eye, MapPin } from "lucide-react";
import type { NavItem } from "@/config/navigation";
import { LogoMark } from "@/components/brand/logo";
import { useActiveClient } from "@/components/providers/active-client-provider";
import { Avatar } from "@/components/shared/avatar";
import { ConnectionPill } from "@/components/shared/connection-pill";
import { InstagramIssueBanner } from "@/components/shared/instagram-issue-banner";
import { VerifyEmailBanner } from "@/components/shared/verify-email-banner";
import { Button } from "@/components/ui/button";
import { exitPreviewAction } from "@/lib/auth/actions";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { PreferencesSync } from "@/components/providers/preferences-sync";
import type { UiPreferences } from "@/types";
import { AssistantBanner, useAssistantBanner } from "@/components/assistant/assistant-panel";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { MobileTabBar } from "./mobile-tab-bar";
import { NavIcon } from "./nav-icon";
import { CONTENT_INSET, ProfileMenu, type MenuUser, type MenuUserBase } from "./profile-menu";
import { Sidebar } from "./sidebar";

/** `nav` is built on the server from the enabled features — hidden items never reach the browser. */
export function UserShell({
  user: base,
  nav,
  preferences,
  emailUnverified = false,
  children,
}: {
  user: MenuUserBase;
  nav: NavItem[];
  preferences: UiPreferences;
  /** Self sign-ups see a banner until they click the emailed link. */
  emailUnverified?: boolean;
  children: ReactNode;
}) {
  const { client, isPreview } = useActiveClient();
  const { t, locale } = useI18n();
  const withBanner = useAssistantBanner();

  // In preview the menu belongs to the admin; otherwise to the signed-in user.
  const user: MenuUser =
    base.role === "admin"
      ? { ...base, secondary: t("roles.admin"), profileHref: "/admin/profile", settingsHref: "/admin/system" }
      : {
          ...base,
          secondary: client.instagramHandle === null ? client.businessName : `@${client.handle}`,
          profileHref: "/dashboard",
          settingsHref: "/settings",
          plan: client.plan,
          // Phones: the tab bar is full, so these live in the menu.
          shortcuts: nav
            .filter((item) => item.href === "/recommendations" || item.href === "/reports")
            .map((item) => ({ href: item.href, label: t(item.labelKey), icon: <NavIcon name={item.icon} className="size-4" /> })),
        };

  const main = nav.filter((i) => i.href !== "/settings");
  const bottom = nav.filter((i) => i.href === "/settings");

  return (
    <div className="min-h-dvh">
      <PreferencesSync saved={preferences} />
      <Sidebar items={main} bottomItems={bottom} homeHref="/dashboard" user={user} />
      <div className={CONTENT_INSET}>
        {isPreview && (
          <div className="flex items-center gap-3 bg-foreground px-4 py-2 text-background md:px-8">
            <Eye className="size-4 shrink-0" />
            <p className="min-w-0 flex-1 truncate text-caption font-semibold">
              {t("preview.banner", { name: locale === "ar" ? client.businessNameAr : client.businessName })}
            </p>
            <Button
              size="sm"
              variant="primary"
              className="h-7 px-3 text-caption"
              onClick={() => startTransition(() => exitPreviewAction())}
            >
              {t("preview.exit")}
            </Button>
          </div>
        )}

        {!isPreview && <VerifyEmailBanner unverified={emailUnverified} email={base.email} />}
        {client.instagramIssue && !isPreview && <InstagramIssueBanner issue={client.instagramIssue} />}

        <header className="sticky top-0 z-20 h-(--topbar-height) border-b border-border bg-background">
          <div className="mx-auto flex h-full max-w-(--content-max-width) items-center gap-3 px-4 md:px-8">
            <Link href="/dashboard" className="md:hidden" aria-label="Local Growth Engine">
              <LogoMark className="size-7" />
            </Link>
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar
                src={client.avatarUrl}
                initials={client.avatarInitials}
                tone={client.avatarTone}
                size="sm"
                ring="story"
                className="hidden sm:inline-flex"
              />
              <div className="min-w-0 leading-4">
                <p className="truncate text-body font-semibold">{client.handle}</p>
                <p className="flex items-center gap-1 truncate text-caption text-muted">
                  <MapPin className="size-3 shrink-0" aria-hidden="true" />
                  {locale === "ar" ? client.locationAr : client.location}
                </p>
              </div>
            </div>

            <div className="ms-auto flex items-center gap-1 sm:gap-2">
              {/* Only the Instagram connection here; plan, language and appearance are in the profile menu. */}
              <ConnectionPill status={client.connection} withIcon />
              <NotificationBell />
              <ProfileMenu user={user} />
            </div>
          </div>
        </header>

        <main
          className={cn(
            "mx-auto max-w-(--content-max-width) px-4 pt-6 md:px-8",
            // Room for the assistant banner (and the tab bar on phones) so nothing hides behind them.
            withBanner ? "pb-[calc(var(--tabbar-height)+var(--assistant-bar-height)+32px)] md:pb-[calc(var(--assistant-bar-height)+48px)]" : "pb-[calc(var(--tabbar-height)+32px)] md:pb-12",
          )}
        >
          {children}
        </main>
      </div>
      <AssistantBanner />
      <MobileTabBar items={nav.filter((i) => i.mobile)} homeHref="/dashboard" />
    </div>
  );
}
