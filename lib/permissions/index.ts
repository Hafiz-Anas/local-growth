import { FEATURE_KEYS, FEATURE_MODULES } from "@/config/features";
import type { NavItem } from "@/config/navigation";
import type { FeatureKey, Permissions } from "@/types";

const MODULE_KEYS = new Set<string>(FEATURE_MODULES.map((m) => m.moduleKey).filter(Boolean) as string[]);

/** Module key a feature depends on, if any ("engagement.autoReply" → "engagement"). */
export function parentModule(key: FeatureKey): FeatureKey | null {
  const [head] = key.split(".");
  return key.includes(".") && MODULE_KEYS.has(head) ? (head as FeatureKey) : null;
}

/** A feature is enabled only if it AND its parent module are ON. */
export function isFeatureEnabled(permissions: Permissions | undefined, key: FeatureKey): boolean {
  if (!permissions || !permissions[key]) return false;
  const parent = parentModule(key);
  return parent ? permissions[parent] === true : true;
}

export function filterNav(items: NavItem[], permissions: Permissions | undefined): NavItem[] {
  return items.filter((item) => !item.feature || isFeatureEnabled(permissions, item.feature));
}

export function countEnabled(permissions: Permissions): number {
  return FEATURE_KEYS.filter((key) => isFeatureEnabled(permissions, key)).length;
}

export function allOff(): Permissions {
  return Object.fromEntries(FEATURE_KEYS.map((key) => [key, false])) as Permissions;
}

export function isFeatureKey(key: string): key is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(key);
}

/** Builds the ON/OFF map from stored rows. Unknown keys are ignored, missing keys are OFF. */
export function permissionsFromRows(rows: Array<{ featureKey: string; enabled: boolean }>): Permissions {
  const permissions = allOff();
  for (const row of rows) if (isFeatureKey(row.featureKey)) permissions[row.featureKey] = row.enabled;
  return permissions;
}

/** Effective keys (feature AND its module ON) — what the session carries. */
export function enabledFeatureKeys(permissions: Permissions): FeatureKey[] {
  return FEATURE_KEYS.filter((key) => isFeatureEnabled(permissions, key));
}

/** Inverse of `enabledFeatureKeys`. */
export function permissionsFromKeys(keys: readonly string[]): Permissions {
  const permissions = allOff();
  for (const key of keys) if (isFeatureKey(key)) permissions[key] = true;
  return permissions;
}
