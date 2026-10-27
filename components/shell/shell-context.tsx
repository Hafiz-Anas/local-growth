"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { MenuUser } from "@/components/layout/profile-menu";

/** The profile menu's user, for headers rendered outside the shell (the AI tab has its own on phones). */
const MenuUserContext = createContext<MenuUser | null>(null);

export function MenuUserProvider({ user, children }: { user: MenuUser; children: ReactNode }) {
  return <MenuUserContext.Provider value={user}>{children}</MenuUserContext.Provider>;
}

export function useMenuUser() {
  const user = useContext(MenuUserContext);
  if (!user) throw new Error("useMenuUser must be used inside <MenuUserProvider>");
  return user;
}
