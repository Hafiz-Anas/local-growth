import "server-only";
import { db } from "@/lib/db";
import { connectFlow, readMetaConfig } from "@/lib/services/meta/config";
import { planSchema } from "@/lib/validation/api";
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

export async function getAdminSettings(): Promise<AdminSettingsDto> {
  const [selfSignupPlan, requireInstagramConnection] = await Promise.all([getSelfSignupPlan(), getRequireInstagramConnection()]);
  const { config, missing } = readMetaConfig();
  return {
    selfSignupPlan,
    requireInstagramConnection,
    meta: { flow: connectFlow(), configured: Boolean(config), graphVersion: config?.graphVersion ?? null, missing },
  };
}

export async function setSelfSignupPlan(plan: PlanId) {
  await db.systemSetting.upsert({ where: { key: SELF_SIGNUP_PLAN }, update: { value: plan }, create: { key: SELF_SIGNUP_PLAN, value: plan } });
}
