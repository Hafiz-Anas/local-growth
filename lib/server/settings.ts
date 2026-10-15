import "server-only";
import { db } from "@/lib/db";
import { connectFlow, readMetaConfig } from "@/lib/services/meta/config";
import { DEFAULT_PLAN_LIMITS, type PlanLimits } from "@/config/plans";
import { planLimitsSchema, planSchema } from "@/lib/validation/api";
import type { AdminSettingsDto, PlanId } from "@/types";

/** Platform-wide settings stored in SystemSetting (key → JSON value). */

const SELF_SIGNUP_PLAN = "selfSignupPlan";
const DEFAULT_SELF_SIGNUP_PLAN: PlanId = "starter";

/** Plan preset (and plan) a self sign-up starts on. Admins change it on the System page. */
export async function getSelfSignupPlan(): Promise<PlanId> {
  const row = await db.systemSetting.findUnique({ where: { key: SELF_SIGNUP_PLAN }, select: { value: true } });
  const parsed = planSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : DEFAULT_SELF_SIGNUP_PLAN;
}

const REQUIRE_INSTAGRAM = "requireInstagramConnection";

/** Whether onboarding can only be finished with Instagram connected (default off). */
export async function getRequireInstagramConnection(): Promise<boolean> {
  const row = await db.systemSetting.findUnique({ where: { key: REQUIRE_INSTAGRAM }, select: { value: true } });
  return row?.value === true;
}

export async function setRequireInstagramConnection(value: boolean) {
  await db.systemSetting.upsert({ where: { key: REQUIRE_INSTAGRAM }, update: { value }, create: { key: REQUIRE_INSTAGRAM, value } });
}

const PLAN_LIMITS = "planLimits";

/** Limits per plan: the admin's values over the defaults (config/plans.ts). */
export async function getPlanLimits(): Promise<Record<PlanId, PlanLimits>> {
  const row = await db.systemSetting.findUnique({ where: { key: PLAN_LIMITS }, select: { value: true } });
  const parsed = planLimitsSchema.safeParse(row?.value ?? {});
  const saved = parsed.success ? parsed.data : {};
  return {
    starter: { ...DEFAULT_PLAN_LIMITS.starter, ...saved.starter },
    growth: { ...DEFAULT_PLAN_LIMITS.growth, ...saved.growth },
    pro: { ...DEFAULT_PLAN_LIMITS.pro, ...saved.pro },
  };
}

export async function setPlanLimits(patch: Partial<Record<PlanId, PlanLimits>>) {
  const value = { ...(await getPlanLimits()), ...patch };
  await db.systemSetting.upsert({ where: { key: PLAN_LIMITS }, update: { value }, create: { key: PLAN_LIMITS, value } });
}

export async function getAdminSettings(): Promise<AdminSettingsDto> {
  const [selfSignupPlan, requireInstagramConnection, planLimits] = await Promise.all([getSelfSignupPlan(), getRequireInstagramConnection(), getPlanLimits()]);
  const { config, missing } = readMetaConfig();
  return {
    selfSignupPlan,
    requireInstagramConnection,
    planLimits,
    meta: { flow: connectFlow(), configured: Boolean(config), graphVersion: config?.graphVersion ?? null, missing },
  };
}

export async function setSelfSignupPlan(plan: PlanId) {
  await db.systemSetting.upsert({ where: { key: SELF_SIGNUP_PLAN }, update: { value: plan }, create: { key: SELF_SIGNUP_PLAN, value: plan } });
}
