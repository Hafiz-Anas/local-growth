import { isKuwaitArea, governorateOf } from "../config/kuwait";
import { AIM_FOR_TARGET, FEELINGS, MAX_TARGET_NUMBER, SERVICE_MODES, TARGETS, type BusinessAim, type Feeling, type ServiceMode, type Target, type TargetKey } from "../config/onboarding";

/**
 * Onboarding answers, the pure rules shared by the API and tests: stored targets, the old "main aim"
 * a target maps to, and which location answers are valid. Pure (no server-only) so it can be
 * unit-tested.
 */

/** Business.targets (JSON) → known targets, each once, with a whole positive number or none. */
export function readTargets(stored: unknown): Target[] {
  if (!Array.isArray(stored)) return [];
  const seen = new Set<TargetKey>();
  const out: Target[] = [];
  for (const item of stored) {
    const key = (item as { key?: unknown } | null)?.key;
    if (typeof key !== "string" || !(TARGETS as readonly string[]).includes(key) || seen.has(key as TargetKey)) continue;
    seen.add(key as TargetKey);
    const n = Number((item as { number?: unknown }).number);
    out.push({ key: key as TargetKey, number: Number.isInteger(n) && n > 0 && n <= MAX_TARGET_NUMBER ? n : null });
  }
  return out;
}

/** The old single "main aim" (weekly report, Settings → Goals) for the first target picked. */
export function aimFromTargets(targets: Target[]): BusinessAim | null {
  return targets.length ? AIM_FOR_TARGET[targets[0].key] : null;
}

export const isFeeling = (value: string): value is Feeling => (FEELINGS as readonly string[]).includes(value);
export const isServiceMode = (value: string): value is ServiceMode => (SERVICE_MODES as readonly string[]).includes(value);

/** A governorate alone is fine; an area must belong to its governorate. */
export function validLocation(governorate: string | null, area: string | null): boolean {
  if (!governorate) return area === null;
  if (!governorateOf(governorate)) return false;
  return area === null || isKuwaitArea(governorate, area);
}
