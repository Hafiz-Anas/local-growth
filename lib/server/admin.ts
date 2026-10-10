import "server-only";
import { FEATURE_KEYS } from "@/config/features";
import { stepId } from "@/config/onboarding";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { enabledFeatureKeys, permissionsFromRows } from "@/lib/permissions";
import type { AdminBusinessDto, BusinessSource, OnboardingStatus, UserStatus } from "@/types";
import { BUSINESS_SUMMARY_SELECT, toBusinessSummary } from "./dto";
import { notFound } from "./http";

export const ADMIN_BUSINESS_SELECT = {
  ...BUSINESS_SUMMARY_SELECT,
  createdAt: true,
  source: true,
  onboardingStatus: true,
  onboardingStep: true,
  onboardingInvitedAt: true,
  users: { select: { id: true, email: true, name: true, status: true }, orderBy: { createdAt: "asc" } },
  permissions: { select: { featureKey: true, enabled: true } },
  activity: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
} satisfies Prisma.BusinessSelect;

export function toAdminBusiness(row: Prisma.BusinessGetPayload<{ select: typeof ADMIN_BUSINESS_SELECT }>): AdminBusinessDto {
  return {
    ...toBusinessSummary(row),
    createdAt: row.createdAt.toISOString(),
    users: row.users.map((u) => ({ ...u, status: u.status.toLowerCase() as UserStatus })),
    enabledFeatures: enabledFeatureKeys(permissionsFromRows(row.permissions)).length,
    totalFeatures: FEATURE_KEYS.length,
    lastActivityAt: row.activity[0]?.createdAt.toISOString() ?? null,
    source: row.source.toLowerCase() as BusinessSource,
    onboardingStatus: row.onboardingStatus.toLowerCase() as OnboardingStatus,
    onboardingStep: stepId(row.onboardingStep),
    onboardingInvitedAt: row.onboardingInvitedAt?.toISOString() ?? null,
  };
}

export async function getAdminBusiness(id: string): Promise<AdminBusinessDto> {
  const row = await db.business.findUnique({ where: { id }, select: ADMIN_BUSINESS_SELECT });
  if (!row) throw notFound("Business");
  return toAdminBusiness(row);
}
