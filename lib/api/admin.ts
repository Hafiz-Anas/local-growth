"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { Locale } from "@/config/site";
import { initials, toneFor } from "@/lib/utils";
import type {
  ActivityLogDto,
  AdminBusinessDto,
  AdminIntegrationDto,
  AdminOnboardingDto,
  AdminOverviewDto,
  AdminSettingsDto,
  AdminSystemDto,
  AdminUserDto,
  BrandProfileDto,
  Client,
  Paginated,
  PermissionsDto,
} from "@/types";
import { apiFetch, type ApiClientError } from "./client";
import { qk } from "./queries";

export const useAdminOverview = () => useQuery<AdminOverviewDto, ApiClientError>({ queryKey: qk.admin.overview, queryFn: () => apiFetch("/api/admin/overview") });

export const useAdminBusinesses = () =>
  useQuery<AdminBusinessDto[], ApiClientError>({ queryKey: qk.admin.businesses, queryFn: () => apiFetch("/api/admin/businesses") });

export const useAdminBusiness = (id: string) =>
  useQuery<AdminBusinessDto, ApiClientError>({ queryKey: qk.admin.business(id), queryFn: () => apiFetch(`/api/admin/businesses/${id}`) });

export const useAdminPermissions = (id: string) =>
  useQuery<PermissionsDto, ApiClientError>({ queryKey: qk.admin.permissions(id), queryFn: () => apiFetch(`/api/admin/businesses/${id}/permissions`) });

export const useAdminUsers = (businessId?: string) =>
  useQuery<AdminUserDto[], ApiClientError>({
    queryKey: qk.admin.users(businessId),
    queryFn: () => apiFetch(`/api/admin/users${businessId ? `?businessId=${encodeURIComponent(businessId)}` : ""}`),
  });

export const useAdminSystem = () => useQuery<AdminSystemDto, ApiClientError>({ queryKey: qk.admin.system, queryFn: () => apiFetch("/api/admin/system") });

export const useAdminOnboarding = () =>
  useQuery<AdminOnboardingDto, ApiClientError>({ queryKey: qk.admin.onboarding, queryFn: () => apiFetch("/api/admin/onboarding") });

export const useAdminSettings = () =>
  useQuery<AdminSettingsDto, ApiClientError>({ queryKey: qk.admin.settings, queryFn: () => apiFetch("/api/admin/settings") });

/** A client's Instagram connection details and Meta integration log. */
export const useAdminIntegration = (id: string) =>
  useQuery<AdminIntegrationDto, ApiClientError>({ queryKey: qk.admin.integration(id), queryFn: () => apiFetch(`/api/admin/businesses/${id}/integration`) });

/** A client's brand context and brand posts (read-only). */
export const useAdminBrand = (id: string) =>
  useQuery<BrandProfileDto, ApiClientError>({ queryKey: qk.admin.brand(id), queryFn: () => apiFetch(`/api/admin/businesses/${id}/brand`) });

/** Activity log, newest first, loaded a page at a time. */
export const useAdminActivity = (businessId?: string, pageSize = 10) =>
  useInfiniteQuery<Paginated<ActivityLogDto>, ApiClientError>({
    queryKey: [...qk.admin.activity(businessId), pageSize],
    initialPageParam: null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(pageSize) });
      if (businessId) params.set("businessId", businessId);
      if (pageParam) params.set("cursor", String(pageParam));
      return apiFetch(`/api/admin/activity?${params}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });

/** Admin list rows reuse the shared <ClientRow> / avatar components, which take a `Client`. */
export function businessToClient(b: AdminBusinessDto): Client {
  const owner = b.users[0];
  return {
    id: b.id,
    userId: owner?.id ?? "",
    businessName: b.name,
    businessNameAr: b.nameAr ?? b.name,
    handle: b.instagramHandle ?? b.name,
    instagramHandle: b.instagramHandle,
    category: b.category ?? "",
    categoryAr: b.categoryAr ?? b.category ?? "",
    location: b.location,
    locationAr: b.locationAr ?? b.location,
    timezone: b.timezone,
    email: owner?.email ?? "",
    plan: b.plan,
    connection: b.connection,
    connectedAt: null,
    lastActivityAt: b.lastActivityAt ?? b.createdAt,
    followers: 0,
    following: 0,
    posts: 0,
    bio: "",
    website: "",
    whatsappNumber: "",
    postsPublishedToday: 0,
    avatarUrl: b.avatarUrl,
    avatarTone: toneFor(b.instagramHandle ?? b.id),
    avatarInitials: initials(b.name),
  };
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/**
 * One readable sentence for an activity entry. Seeded history carries its own
 * English/Arabic text; everything else is described from the action name.
 */
export function activityText(item: ActivityLogDto, t: Translate, locale: Locale): string {
  const details = (item.details ?? {}) as Record<string, unknown>;
  if (typeof details.message === "string") {
    return locale === "ar" && typeof details.messageAr === "string" ? details.messageAr : details.message;
  }
  const vars: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === "string" || typeof value === "number") vars[key] = value;
  }
  if (typeof details.to === "string") vars.to = t(`plans.${details.to}`);
  if (typeof details.from === "string") vars.from = t(`plans.${details.from}`);
  if (typeof details.preset === "string") vars.preset = t(`plans.${details.preset}`);
  if (typeof details.window === "string") vars.window = t(`windows.${details.window}`);
  if (details.changes && typeof details.changes === "object") vars.count = Object.keys(details.changes).length;
  const key = `activity.${item.action.replace(/\./g, "_")}`;
  const text = t(key, vars);
  return text === key ? item.action.replace(/[._]/g, " ") : text;
}
