import "server-only";
import { db } from "@/lib/db";
import { getMetaConfig } from "@/lib/services/meta/config";
import { MetaApiError } from "@/lib/services/meta/errors";
import { GraphClient, type GraphCallInfo, type GraphUsage } from "@/lib/services/meta/graph";
import { logIntegration } from "./integration-log";

/**
 * Graph clients bound to a business. Every failed call is written to the
 * IntegrationEvent log and has its side effect on the connection:
 *   token_invalid (190) → status NEEDS_RECONNECT ("Reconnect Instagram" banner)
 *   permission          → the permission is added to missingPermissions
 *   rate_limited / high usage → the business cools down; syncs wait
 */

export class MetaUnavailableError extends Error {
  constructor() {
    super("Meta integration is not configured (META_APP_ID / META_APP_SECRET / META_REDIRECT_URI).");
  }
}

/** Above this usage (percent of Meta's allowance) background syncs pause. */
const USAGE_CEILING_PCT = 90;
const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;

interface UsageState {
  usage: GraphUsage;
  at: number;
  /** Background syncs skip this business until then. */
  coolUntil: number;
}

// In-process state, like the memory rate limiter: resets on restart, which only makes us slightly less cautious.
const usageByKey = new Map<string, UsageState>();

export function usageFor(businessId: string): UsageState | null {
  return usageByKey.get(businessId) ?? null;
}

/** Whether background work for this business should wait (Meta asked us to slow down). */
export function coolingDown(businessId: string): number {
  const state = usageByKey.get(businessId);
  return state && state.coolUntil > Date.now() ? state.coolUntil - Date.now() : 0;
}

function trackUsage(businessId: string, usage: GraphUsage | null, error?: MetaApiError) {
  const previous = usageByKey.get(businessId);
  const state: UsageState = { usage: usage ?? previous?.usage ?? { appPct: 0, businessPct: 0, regainAccessMinutes: 0 }, at: Date.now(), coolUntil: previous?.coolUntil ?? 0 };
  const high = Math.max(state.usage.appPct, state.usage.businessPct) >= USAGE_CEILING_PCT;
  if (error?.kind === "rate_limited" || high) {
    const wait = error?.retryAfterMs ?? (state.usage.regainAccessMinutes ? state.usage.regainAccessMinutes * 60_000 : DEFAULT_COOLDOWN_MS);
    state.coolUntil = Math.max(state.coolUntil, Date.now() + wait);
  }
  usageByKey.set(businessId, state);
}

async function onFailure(businessId: string | null, error: MetaApiError) {
  if (!businessId) return;
  if (error.kind === "token_invalid") {
    await db.instagramConnection.updateMany({ where: { businessId, provider: "META", status: "CONNECTED" }, data: { status: "NEEDS_RECONNECT" } });
  } else if (error.kind === "permission" && error.missingScopes.length) {
    const conn = await db.instagramConnection.findUnique({ where: { businessId }, select: { missingPermissions: true } });
    const merged = [...new Set([...(conn?.missingPermissions ?? []), ...error.missingScopes])];
    if (conn && merged.length !== conn.missingPermissions.length) {
      await db.instagramConnection.update({ where: { businessId }, data: { missingPermissions: merged } });
    }
  }
}

/**
 * Graph client whose failures are logged for `businessId`. `connectionEffects: false`
 * during login: a failure with the *new* token must not flag the existing connection.
 */
export function graphFor(businessId: string | null, { connectionEffects = true } = {}): GraphClient {
  const config = getMetaConfig();
  if (!config) throw new MetaUnavailableError();
  return new GraphClient({
    config,
    onCall: async (info: GraphCallInfo) => {
      if (businessId) trackUsage(businessId, info.usage, info.error);
      if (info.ok || !info.error || info.expected) return;
      const e = info.error;
      await logIntegration({
        businessId,
        level: e.kind === "rate_limited" || e.kind === "transient" ? "warning" : "error",
        call: info.call,
        errorCode: e.codeLabel,
        message: e.message,
        httpStatus: info.httpStatus,
        details: { kind: e.kind, ...(e.fbtraceId && { fbtraceId: e.fbtraceId }), ...(e.missingScopes.length && { missingScopes: e.missingScopes }) },
      });
      if (connectionEffects) await onFailure(businessId, e);
    },
  });
}
