import { META_SCOPES, type MetaScope } from "./config";
import type { TokenInfo } from "./mappers";

/**
 * InstagramConnection.missingPermissions — what the "Instagram permissions are missing" warning
 * shows. Pure, covered by tests/meta/permissions.test.ts.
 *
 *  - On every connect / reconnect it is rebuilt from the scopes /debug_token reports for the new
 *    long-lived user token (never merged with the old list).
 *  - Afterwards a Graph permission error can add a scope. Meta often doesn't name the permission
 *    ("(#200) … one of these permissions is needed: pages_messaging"), and then the scope the call
 *    declared is only a guess: when the token was granted it, the call failed for another reason
 *    and the scope is NOT flagged (the user can't fix it by reconnecting).
 */

/** Requested scopes the token wasn't granted. */
export function missingScopes(granted: readonly string[]): MetaScope[] {
  return META_SCOPES.filter((s) => !granted.includes(s));
}

/** The connection fields a new login replaces: granted scopes, missing permissions, expiries, webhook subscription. */
export function grantFields(info: TokenInfo) {
  return {
    scopes: [...info.scopes],
    missingPermissions: missingScopes(info.scopes),
    tokenExpiresAt: info.expiresAt,
    dataAccessExpiresAt: info.dataAccessExpiresAt,
    // A new login may be a different Page or newly allow pages_manage_metadata: subscribe again.
    webhookSubscribedAt: null,
  };
}

/**
 * missingPermissions after a permission error, or null when nothing changes. `granted` is the
 * scope list saved at connect (null when unknown — then the error is taken at its word).
 */
export function flagMissingScopes(current: readonly string[], error: { missingScopes: readonly string[]; scopesNamed: boolean }, granted: readonly string[] | null): string[] | null {
  const blamed = error.scopesNamed || !granted ? error.missingScopes : error.missingScopes.filter((s) => !granted.includes(s));
  const merged = [...new Set([...current, ...blamed])];
  return merged.length === current.length ? null : merged;
}
