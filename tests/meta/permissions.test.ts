import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { META_SCOPES } from "../../lib/services/meta/config";
import { MetaApiError } from "../../lib/services/meta/errors";
import type { TokenInfo } from "../../lib/services/meta/mappers";
import { flagMissingScopes, grantFields, missingScopes } from "../../lib/services/meta/permissions";

const info = (scopes: readonly string[]): TokenInfo => ({ appId: "1", userId: "u1", scopes: [...scopes], expiresAt: new Date("2026-12-20T00:00:00Z"), dataAccessExpiresAt: null });
const withoutMetadata = META_SCOPES.filter((s) => s !== "pages_manage_metadata");

// What Meta answers when a Page is subscribed to Messenger's "messages" field without pages_messaging.
const messagesFieldError = MetaApiError.fromGraph(
  "POST /{page}/subscribed_apps",
  { message: "(#200) To subscribe to the messages field, one of these permissions is needed: pages_messaging", type: "OAuthException", code: 200 },
  403,
  ["pages_manage_metadata"],
);

describe("missing permissions", () => {
  it("all scopes granted → no warning", () => {
    assert.deepEqual(missingScopes(META_SCOPES), []);
    assert.deepEqual(grantFields(info(META_SCOPES)).missingPermissions, []);
  });

  it("pages_manage_metadata declined → warning", () => {
    assert.deepEqual(missingScopes(withoutMetadata), ["pages_manage_metadata"]);
    assert.deepEqual(grantFields(info(withoutMetadata)).missingPermissions, ["pages_manage_metadata"]);
  });

  it("reconnect replaces the saved scopes and missing permissions and re-arms the webhook subscription", () => {
    const before = grantFields(info(withoutMetadata));
    assert.equal(before.scopes.includes("pages_manage_metadata"), false);
    const after = grantFields(info(META_SCOPES));
    assert.deepEqual(after.scopes, [...META_SCOPES]);
    assert.deepEqual(after.missingPermissions, []);
    assert.equal(after.webhookSubscribedAt, null);
    assert.equal(after.tokenExpiresAt?.toISOString(), "2026-12-20T00:00:00.000Z");
  });
});

describe("flagMissingScopes (permission errors after connecting)", () => {
  it("doesn't blame a granted scope Meta didn't name", () => {
    assert.equal(messagesFieldError.kind, "permission");
    assert.equal(messagesFieldError.scopesNamed, false);
    assert.equal(flagMissingScopes([], messagesFieldError, META_SCOPES), null);
  });

  it("flags the declared scope when it wasn't granted (or the grant is unknown)", () => {
    assert.deepEqual(flagMissingScopes([], messagesFieldError, withoutMetadata), ["pages_manage_metadata"]);
    assert.deepEqual(flagMissingScopes([], messagesFieldError, null), ["pages_manage_metadata"]);
  });

  it("trusts a scope Meta names (revoked since connecting)", () => {
    const named = MetaApiError.fromGraph("POST /{ig-comment}/replies", { message: "(#200) Requires instagram_manage_comments permission", code: 200 }, 403, ["instagram_basic"]);
    assert.equal(named.scopesNamed, true);
    assert.deepEqual(flagMissingScopes(["instagram_manage_insights"], named, META_SCOPES), ["instagram_manage_insights", "instagram_manage_comments"]);
  });

  it("returns null when the scope is already flagged", () => {
    assert.equal(flagMissingScopes(["pages_manage_metadata"], messagesFieldError, withoutMetadata), null);
  });
});
