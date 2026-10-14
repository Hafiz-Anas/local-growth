"use client";

import type { ReactNode } from "react";
import { startTransition } from "react";
import Link from "next/link";
import { Bot, Eye, MapPin } from "lucide-react";
import type { NavItem } from "@/config/navigation";
import { LogoMark } from "@/components/brand/logo";
import { useActiveClient } from "@/components/providers/active-client-provider";
import { Avatar } from "@/components/shared/avatar";
import { PlanBadge } from "@/components/shared/client-row";
import { ConnectionPill } from "@/components/shared/connection-pill";
import { InstagramIssueBanner } from "@/components/shared/instagram-issue-banner";
import { VerifyEmailBanner } from "@/components/shared/verify-email-banner";
import { Button } from "@/components/ui/button";
import { exitPreviewAction } from "@/lib/auth/actions";
import { useI18n } from "@/lib/i18n/provider";
import { PreferencesSync } from "@/components/providers/preferences-sync";
import type { UiPreferences } from "@/types";
import { MobileTabBar } from "./mobile-tab-bar";
import { CONTENT_INSET, ProfileMenu, type MenuUser, type MenuUserBase } from "./profile-menu";
import { Sidebar } from "./sidebar";
import { LanguageToggle, ThemeToggle } from "./toggles";

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

  // In preview the menu belongs to the admin; otherwise to the signed-in user.
  const user: MenuUser =
    base.role === "admin"
      ? { ...base, secondary: t("roles.admin"), profileHref: "/admin/profile", settingsHref: "/admin/system" }
      : { ...base, secondary: client.instagramHandle === null ? client.businessName : `@${client.handle}`, profileHref: "/dashboard", settingsHref: "/settings" };

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
              <ConnectionPill status={client.connection} withIcon className="hidden sm:inline-flex" />
              <PlanBadge plan={client.plan} className="hidden sm:inline-flex" />
              {/* Phones: the bottom tab bar is full, so the assistant sits in the header (until the mobile redesign). */}
              {nav.some((item) => item.href === "/assistant") && (
                <Button asChild variant="ghost" size="icon-sm" className="md:hidden">
                  <Link href="/assistant" aria-label={t("nav.assistant")}>
                    <Bot aria-hidden="true" />
                  </Link>
                </Button>
              )}
              <ThemeToggle />
              <span className="hidden lg:inline-flex">
                <LanguageToggle />
              </span>
              <span className="lg:hidden">
                <LanguageToggle compact />
              </span>
              <ProfileMenu user={user} />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-(--content-max-width) px-4 pt-6 pb-[calc(var(--tabbar-height)+32px)] md:px-8 md:pb-12">
          {children}
        </main>
      </div>
      <MobileTabBar items={nav.filter((i) => i.mobile)} homeHref="/dashboard" />
    </div>
  );
}
