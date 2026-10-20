"use client";

import { useQuery } from "@tanstack/react-query";
import type { DeviceAccountsDto } from "@/types";
import { ApiClientError, apiFetch } from "./client";
import { qk } from "./queries";

/** The logins remembered on this browser ("Accounts on this device", lib/server/device-logins.ts). */
export const useDeviceAccounts = (enabled = true) =>
  useQuery<DeviceAccountsDto, ApiClientError>({
    queryKey: qk.deviceAccounts,
    queryFn: () => apiFetch<DeviceAccountsDto>("/api/device-accounts"),
    enabled,
    staleTime: 30_000,
  });

/**
 * "Log out of @handle" (moves on to another login remembered here, if any) or, with `all`, "Log out of all
 * accounts". Always a full page load afterwards, so nothing of the old account stays in memory.
 */
export async function logOutOf(all: boolean): Promise<void> {
  let to = "/login";
  try {
    ({ to } = await apiFetch<{ to: string }>("/api/device-accounts/logout", { method: "POST", body: { all } }));
  } catch (error) {
    // This tab still showed a login switched away from elsewhere: apiFetch reloads it into the active one.
    if (error instanceof ApiClientError && error.code === "account_switched") return;
    // Signed out already (401) or offline: the login page either way.
  }
  window.location.assign(to);
}

/** Opens "Add account" (log in or sign up another login) as a full page load, so this account's data doesn't come along. */
export function openAddAccount(kind: "login" | "signup") {
  window.location.assign(new URL(`/${kind}?add=1`, window.location.origin));
}
