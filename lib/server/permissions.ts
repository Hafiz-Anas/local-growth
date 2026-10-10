import "server-only";
import { FEATURE_KEYS } from "@/config/features";
import { PLAN_IDS, PLAN_PRESETS } from "@/config/plans";
import { db } from "@/lib/db";
import type { Plan, Prisma } from "@/lib/generated/prisma/client";
import { enabledFeatureKeys, permissionsFromRows } from "@/lib/permissions";
import type { FeatureKey, Permissions, PermissionsDto, PlanId } from "@/types";
import { logActivity } from "./activity";
import { notFound } from "./http";

const toDbPlan = (plan: PlanId) => plan.toUpperCase() as Plan;

function matchingPreset(permissions: Permissions): PlanId | null {
  return PLAN_IDS.find((plan) => FEATURE_KEYS.every((key) => Boolean(permissions[key]) === Boolean(PLAN_PRESETS[plan][key]))) ?? null;
}

export async function getPermissionsDto(businessId: string): Promise<PermissionsDto> {
  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { plan: true, permissions: { select: { featureKey: true, enabled: true } } },
  });
  if (!business) throw notFound("Business");
  const permissions = permissionsFromRows(business.permissions);
  return {
    businessId,
    plan: business.plan.toLowerCase() as PlanId,
    permissions,
    enabled: enabledFeatureKeys(permissions),
    matchesPreset: matchingPreset(permissions),
  };
}

/** Rows for a new business: one per feature key, from the plan preset. */
export function presetRows(plan: PlanId): Array<{ featureKey: string; enabled: boolean }> {
  return FEATURE_KEYS.map((featureKey) => ({ featureKey, enabled: PLAN_PRESETS[plan][featureKey] }));
}

async function writePermissions(tx: Prisma.TransactionClient, businessId: string, changes: Partial<Record<FeatureKey, boolean>>) {
  for (const [featureKey, enabled] of Object.entries(changes) as Array<[FeatureKey, boolean]>) {
    await tx.featurePermission.upsert({
      where: { businessId_featureKey: { businessId, featureKey } },
      update: { enabled },
      create: { businessId, featureKey, enabled },
    });
  }
  // Live sessions of this business's users reload their feature list on their next request.
  await tx.business.update({ where: { id: businessId }, data: { permissionsUpdatedAt: new Date() } });
}

/** Admin: switch individual features. Logs only the keys that actually changed. */
export async function updatePermissions(businessId: string, changes: Partial<Record<FeatureKey, boolean>>, actorId: string) {
  const before = (await getPermissionsDto(businessId)).permissions;
  const diff = Object.fromEntries(Object.entries(changes).filter(([key, value]) => before[key as FeatureKey] !== value));
  if (Object.keys(diff).length > 0) {
    await db.$transaction(async (tx) => {
      await writePermissions(tx, businessId, diff);
      await logActivity({ businessId, userId: actorId, action: "permissions.updated", details: { changes: diff } }, tx);
    });
  }
  return getPermissionsDto(businessId);
}

/** Admin: replace all permissions with a plan preset, optionally switching the plan too. */
export async function applyPlanPreset(businessId: string, plan: PlanId, setPlan: boolean, actorId: string) {
  const before = await getPermissionsDto(businessId);
  await db.$transaction(async (tx) => {
    await writePermissions(tx, businessId, PLAN_PRESETS[plan]);
    if (setPlan && before.plan !== plan) {
      await tx.business.update({ where: { id: businessId }, data: { plan: toDbPlan(plan) } });
      await logActivity({ businessId, userId: actorId, action: "business.plan_changed", details: { from: before.plan, to: plan } }, tx);
    }
    await logActivity({ businessId, userId: actorId, action: "permissions.preset_applied", details: { preset: plan } }, tx);
  });
  return getPermissionsDto(businessId);
}
