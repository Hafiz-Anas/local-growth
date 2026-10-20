"use client";

import type { ReactNode } from "react";
import { startTransition, useEffect } from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import type { NavItem } from "@/config/navigation";
import { LogoMark } from "@/components/brand/logo";
import { useActiveClient } from "@/components/providers/active-client-provider";
import { ConnectionPill } from "@/components/shared/connection-pill";
import { InstagramIssueBanner } from "@/components/shared/instagram-issue-banner";
import { VerifyEmailBanner } from "@/components/shared/verify-email-banner";
import { Button } from "@/components/ui/button";
import { exitPreviewAction } from "@/lib/auth/actions";
import { useI18n } from "@/lib/i18n/provider";
import { splitForPhone } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { notify } from "@/store/ui-store";
import { PreferencesSync } from "@/components/providers/preferences-sync";
import type { UiPreferences } from "@/types";
import { AssistantBanner, useAssistantBanner } from "@/components/assistant/assistant-panel";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { MobileTabBar } from "./mobile-tab-bar";
import { NavIcon } from "./nav-icon";
import { ActiveAccountSwitcher } from "./login-switcher";
import { CONTENT_INSET, ProfileMenu, type MenuUser, type MenuUserBase } from "./profile-menu";
import { SectionTabs } from "./section-tabs";
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
  const accountLabel = client.instagramHandle ? `@${client.instagramHandle}` : locale === "ar" ? client.businessNameAr : client.businessName;

  // After switching to another login (?switched=1, a full page load): "Switched to @handle", once.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("switched")) return;
    url.searchParams.delete("switched");
    window.history.replaceState(window.history.state, "", url);
    notify.success(t("deviceAccounts.switched", { account: accountLabel }));
  }, [accountLabel, t]);
  const phone = splitForPhone(nav);
  // Phones: sections that don't fit the tab bar live in the profile menu.
  const shortcuts = phone.more.map((item) => ({ href: item.href, label: t(item.labelKey), icon: <NavIcon name={item.icon} className="size-4" /> }));

  // In preview the menu belongs to the admin; otherwise to the signed-in user.
  const user: MenuUser =
    base.role === "admin"
      ? { ...base, secondary: t("roles.admin"), profileHref: "/admin/profile", settingsHref: "/admin/system", shortcuts }
      : {
          ...base,
          secondary: client.instagramHandle === null ? client.businessName : `@${client.handle}`,
          accountLabel,
          settingsHref: "/settings",
          plan: client.plan,
          shortcuts,
        };

  const main = nav.filter((i) => i.placement !== "bottom");
  const bottom = nav.filter((i) => i.placement === "bottom");

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
            {/* The active Instagram account; tapping it switches between the logins remembered on this device. */}
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
          <SectionTabs nav={nav} homeHref="/dashboard" />
          {children}
        </main>
      </div>
      <AssistantBanner />
      <MobileTabBar items={phone.tabs} homeHref="/dashboard" />
    </div>
  );
}
