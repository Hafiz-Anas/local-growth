"use client";

import { ProfileMenu } from "@/components/layout/profile-menu";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { useMenuUser } from "./shell-context";

/** The bell, then the profile menu (Settings, language, theme, log out). In the header and the AI tab's phone header. */
export function HeaderActions() {
  const user = useMenuUser();
  return (
    <>
      <NotificationBell />
      <ProfileMenu user={user} />
    </>
  );
}
