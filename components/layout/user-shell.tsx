"use client";

import type { ReactNode } from "react";
import { startTransition, useEffect } from "react";
import { usePathname } from "next/navigation";
import { DirectionProvider } from "@base-ui/react/direction-provider";
import { MotionConfig } from "framer-motion";
import { useTheme } from "next-themes";
import { Toaster } from "sonner";
import { Eye } from "lucide-react";
import type { NavItem } from "@/config/navigation";
import { PhotoViewer } from "@/components/gallery/photo-viewer";
import { GallerySync } from "@/components/gallery/gallery-sync";
import { SheetHost } from "@/components/gallery/sheets/sheet-host";
import { useActiveClient } from "@/components/providers/active-client-provider";
import { InstagramIssueBanner } from "@/components/shared/instagram-issue-banner";
import { VerifyEmailBanner } from "@/components/shared/verify-email-banner";
import { EdgeSwipeBack } from "@/components/shell/edge-swipe";
import { HOME_HREF } from "@/components/shell/nav";
import { MenuUserProvider } from "@/components/shell/shell-context";
import { TabBar } from "@/components/shell/tab-bar";
import { TopBar } from "@/components/shell/top-bar";
import { Button } from "@/components/ui/button";
import { exitPreviewAction } from "@/lib/auth/actions";
import { useI18n } from "@/lib/i18n/provider";
import { isActivePath, splitForPhone } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { notify } from "@/store/ui-store";
import { PreferencesSync } from "@/components/providers/preferences-sync";
import type { UiPreferences } from "@/types";
import { NavIcon } from "./nav-icon";
import { type MenuUser, type MenuUserBase } from "./profile-menu";
import { SectionTabs } from "./section-tabs";
import { CLIENT_CONTENT_INSET, Sidebar } from "./sidebar";

/** Pages laid out edge to edge by the design proposal's own screens (Gallery, AI). */
const PROPOSAL_PAGES = ["/gallery", "/ai"];

/**
 * The client app's shell: the platform's Instagram sidebar on desktop (collapsible, Settings and the
 * profile row at the bottom), the Instagram-style header and the proposal's phone tab bar with AI in the centre.
 * `nav` is built on the server from the enabled features — hidden items never reach the browser.
 */
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
  const { t, locale, dir } = useI18n();
  const { resolvedTheme } = useTheme();
  const pathname = usePathname();
  const onAi = isActivePath(pathname, "/ai");
  const proposalPage = PROPOSAL_PAGES.some((href) => isActivePath(pathname, href));
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

  // Settings sits at the bottom of the sidebar (and in the profile menu).
  const sections = nav.filter((i) => i.placement !== "bottom");
  const bottom = nav.filter((i) => i.placement === "bottom");
  // Room for the tab bar (phones) so nothing hides behind it.
  const bottomRoom = "pb-[calc(76px+env(safe-area-inset-bottom))] lg:pb-12";

  return (
    <DirectionProvider direction={dir}>
      <MotionConfig reducedMotion="user">
        <MenuUserProvider user={user}>
          <div className="min-h-dvh">
            <PreferencesSync saved={preferences} />
            <GallerySync />
            <Sidebar items={sections} bottomItems={bottom} homeHref={HOME_HREF} user={user} from="lg" />
            <div className={cn("min-h-dvh", CLIENT_CONTENT_INSET)}>
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
              {client.instagramIssue && !isPreview && <InstagramIssueBanner />}

              {/* The AI tab has its own header on phones; desktop keeps the regular one. */}
              <TopBar className={cn(onAi && "max-lg:hidden")} />

              {proposalPage ? (
                <main className={cn("ge mx-auto w-full max-w-[935px] lg:px-8", bottomRoom)}>{children}</main>
              ) : (
                <main className={cn("mx-auto max-w-(--content-max-width) px-4 pt-6 md:px-8", bottomRoom)}>
                  <SectionTabs nav={nav} homeHref={HOME_HREF} />
                  {children}
                </main>
              )}
            </div>
            <TabBar items={phone.tabs} />
            <PhotoViewer />
            <SheetHost />
            <EdgeSwipeBack />
            <Toaster
              dir={dir}
              position="top-center"
              theme={resolvedTheme === "dark" ? "dark" : "light"}
              className="ge"
              offset={{ top: "calc(env(safe-area-inset-top) + 12px)" }}
              mobileOffset={{ top: "calc(env(safe-area-inset-top) + 10px)" }}
              toastOptions={{
                classNames: {
                  toast: "!rounded-2xl !border !bg-ge-elevated !text-ge-foreground !shadow-lg !font-sans !text-[14px] !gap-2",
                  actionButton: "!bg-transparent !text-ge-brand !font-semibold",
                  icon: "!text-ge-brand",
                },
              }}
            />
          </div>
        </MenuUserProvider>
      </MotionConfig>
    </DirectionProvider>
  );
}
