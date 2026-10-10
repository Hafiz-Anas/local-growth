"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { ADMIN_NAV } from "@/config/navigation";
import { LogoMark } from "@/components/brand/logo";
import { useI18n } from "@/lib/i18n/provider";
import { PreferencesSync } from "@/components/providers/preferences-sync";
import type { UiPreferences } from "@/types";
import { MobileTabBar } from "./mobile-tab-bar";
import { CONTENT_INSET, ProfileMenu, type MenuUser, type MenuUserBase } from "./profile-menu";
import { Sidebar } from "./sidebar";
import { LanguageToggle, ThemeToggle } from "./toggles";

export function AdminShell({ user: base, preferences, children }: { user: MenuUserBase; preferences: UiPreferences; children: ReactNode }) {
  const { t } = useI18n();
  const user: MenuUser = { ...base, secondary: t("roles.admin"), profileHref: "/admin/profile", settingsHref: "/admin/system" };
  return (
    <div className="min-h-dvh">
      <PreferencesSync saved={preferences} />
      <Sidebar items={ADMIN_NAV} homeHref="/admin" user={user} />
      <div className={CONTENT_INSET}>
        <header className="sticky top-0 z-20 h-(--topbar-height) border-b border-border bg-background">
          <div className="mx-auto flex h-full max-w-(--content-max-width) items-center gap-3 px-4 md:px-8">
            <Link href="/admin" className="md:hidden" aria-label="Local Growth Engine">
              <LogoMark className="size-7" />
            </Link>
            <div className="flex min-w-0 items-center gap-2">
              <ShieldCheck className="hidden size-5 shrink-0 sm:block" strokeWidth={1.75} aria-hidden="true" />
              <div className="min-w-0 leading-4">
                <p className="truncate text-body font-semibold">{t("common.company")}</p>
                <p className="truncate text-caption text-muted">{t("admin.console")}</p>
              </div>
            </div>
            <div className="ms-auto flex items-center gap-1 sm:gap-2">
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
      <MobileTabBar items={ADMIN_NAV} homeHref="/admin" />
    </div>
  );
}
