"use client";

import { ProfileMenu } from "@/components/layout/profile-menu";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { useMenuUser } from "./shell-context";

/** Notifications bell, then the profile picture (opens the profile menu: Settings, language, theme, log out). Shown in every header. */
export function HeaderActions() {
  const user = useMenuUser();
  return (
    <>
      <NotificationBell look="proposal" />
      <ProfileMenu user={user} look="proposal" />
    </>
  );
}
