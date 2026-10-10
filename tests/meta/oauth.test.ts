import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exchangeCode, exchangeLongLived, inspectToken, listPages } from "../../lib/services/meta/api";
import { buildDialogUrl, connectFlow, ESSENTIAL_SCOPES, META_SCOPES, metaStartupWarning, readMetaConfig } from "../../lib/services/meta/config";
import { MetaApiError } from "../../lib/services/meta/errors";
import { appsecretProof } from "../../lib/services/meta/graph";
import { toPageOption } from "../../lib/services/meta/mappers";
import { CONFIG, client, err, fx, ok } from "./helpers";

describe("config", () => {
  const full = { META_APP_ID: "3457472907767619", META_APP_SECRET: "s3cret", META_REDIRECT_URI: "http://localhost:3000/api/integrations/instagram/callback" };

  it("is disabled (not crashing) when the secret is missing, and says which variable — never its value", () => {
    const { config, missing } = readMetaConfig({ ...full, META_APP_SECRET: "" });
    assert.equal(config, null);
    assert.deepEqual(missing, ["META_APP_SECRET"]);
    const warning = metaStartupWarning({ ...full, META_APP_SECRET: "", INSTAGRAM_PROVIDER: "meta" });
    assert.match(warning ?? "", /META_APP_SECRET/);
    assert.match(warning ?? "", /DISABLED/);
  });

  it("stays quiet when Meta isn't set up and isn't asked for", () => {
    assert.equal(metaStartupWarning({ INSTAGRAM_PROVIDER: "mock" }), null);
    assert.equal(metaStartupWarning({ ...full, INSTAGRAM_PROVIDER: "meta" }), null);
  });

  it("never puts the secret in the warning", () => {
    const warning = metaStartupWarning({ META_APP_ID: "1", META_APP_SECRET: "top-secret-value", INSTAGRAM_PROVIDER: "meta" });
    assert.ok(warning && !warning.includes("top-secret-value"));
  });

  it("INSTAGRAM_PROVIDER picks the connect flow", () => {
    assert.equal(connectFlow({ ...full }), "mock");
    assert.equal(connectFlow({ ...full, INSTAGRAM_PROVIDER: "mock" }), "mock");
    assert.equal(connectFlow({ ...full, INSTAGRAM_PROVIDER: "meta" }), "meta");
    assert.equal(connectFlow({ ...full, META_APP_SECRET: "", INSTAGRAM_PROVIDER: "meta" }), "meta_unavailable");
  });

  it("defaults to Graph v26.0 and code flow", () => {
    const { config } = readMetaConfig(full);
    assert.equal(config?.graphVersion, "v26.0");
    assert.equal(config?.responseType, "code");
    assert.equal(readMetaConfig({ ...full, META_GRAPH_VERSION: "25.0" }).config?.graphVersion, "v25.0");
  });
});

describe("login dialog", () => {
  it("has every parameter Facebook Login for Business needs", () => {
    const url = new URL(buildDialogUrl(CONFIG, "state-123"));
    assert.equal(url.origin + url.pathname, "https://www.facebook.com/v26.0/dialog/oauth");
    assert.equal(url.searchParams.get("client_id"), CONFIG.appId);
    assert.equal(url.searchParams.get("redirect_uri"), CONFIG.redirectUri);
    assert.equal(url.searchParams.get("display"), "page");
    assert.deepEqual(JSON.parse(url.searchParams.get("extras")!), { setup: { channel: "IG_API_ONBOARDING" } });
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("state"), "state-123");
    assert.deepEqual(url.searchParams.get("scope")!.split(","), [...META_SCOPES]);
    assert.equal(url.searchParams.get("auth_type"), null);
    assert.ok(!url.toString().includes(CONFIG.appSecret));
  });

  it("asks again for declined permissions on reconnect", () => {
    assert.equal(new URL(buildDialogUrl(CONFIG, "s", { rerequest: true })).searchParams.get("auth_type"), "rerequest");
  });
});

describe("token exchange (success)", () => {
  it("code → short-lived → long-lived → validated, with the secret only server-side", async () => {
    const { client: c, calls } = client(({ path, params }) => {
      if (path === "oauth/access_token" && params.get("code")) return ok(fx.oauthAccessToken);
      if (path === "oauth/access_token" && params.get("grant_type") === "fb_exchange_token") return ok(fx.oauthLongLived);
      if (path === "debug_token") return ok(fx.debugTokenValid);
      throw new Error(`unexpected ${path}`);
    });
    const short = await exchangeCode(c, "AQB-code");
    const long = await exchangeLongLived(c, short.accessToken);
    const info = await inspectToken(c, long.accessToken);

    assert.equal(long.accessToken, "EAAlonglivedTOKENyyyyyyyyyyyyyyyyyyyyyyyyyyy");
    assert.equal(info.userId, "10229999999999999");
    assert.ok(ESSENTIAL_SCOPES.every((s) => info.scopes.includes(s)));
    assert.equal(info.expiresAt?.toISOString(), new Date(1796860800 * 1000).toISOString());
    assert.equal(info.dataAccessExpiresAt?.toISOString(), new Date(1799452800 * 1000).toISOString());
    // debug_token uses the app token (id|secret) and no appsecret_proof.
    assert.equal(calls[2].params.get("access_token"), `${CONFIG.appId}|${CONFIG.appSecret}`);
    assert.equal(calls[2].params.get("appsecret_proof"), null);
  });

  it("a token that doesn't expire has expiresAt null", async () => {
    const { client: c } = client(() => ok(fx.debugTokenNoNeverExpires));
    assert.equal((await inspectToken(c, "EAAx")).expiresAt, null);
  });

  it("rejects a token issued to another app (fragment-flow token substitution)", async () => {
    const { client: c } = client(() => ok(fx.debugTokenOtherApp));
    await assert.rejects(inspectToken(c, "EAAother"), (e: unknown) => e instanceof MetaApiError && e.kind === "token_invalid" && /different app/.test(e.message));
  });

  it("rejects an expired token", async () => {
    const { client: c } = client(() => ok(fx.debugTokenExpired));
    await assert.rejects(inspectToken(c, "EAAold"), (e: unknown) => e instanceof MetaApiError && e.kind === "token_invalid" && e.codeLabel === "190/463");
  });
});

describe("Pages (/me/accounts)", () => {
  const pages = (fixture: string) => client(({ path }) => (path === "me/accounts" ? ok(fx[fixture]) : err({ error: { code: 100 } })));

  it("one Page with Instagram → one candidate, signed with appsecret_proof", async () => {
    const { client: c, calls } = pages("meAccountsSingle");
    const { candidates, pagesWithoutInstagram } = await listPages(c, "EAAuser");
    assert.equal(candidates.length, 1);
    assert.equal(pagesWithoutInstagram, 0);
    assert.deepEqual(toPageOption(candidates[0]), {
      pageId: "112233445566778",
      pageName: "Al-bait Coffee",
      igUserId: "17841400000000001",
      username: "albait.kw",
      name: "Al-bait",
      pictureUrl: "https://scontent.cdninstagram.com/v/t51/albait.jpg",
      followers: 1840,
      mediaCount: 212,
    });
    assert.equal(calls[0].params.get("appsecret_proof"), appsecretProof("EAAuser", CONFIG.appSecret));
    assert.match(calls[0].params.get("fields")!, /instagram_business_account\{id,username,name,profile_picture_url,followers_count,media_count\}/);
  });

  it("several Pages → the picker gets the ones with Instagram, without tokens", async () => {
    const { client: c } = pages("meAccountsMultiple");
    const { candidates, pagesWithoutInstagram } = await listPages(c, "EAAuser");
    assert.deepEqual(
      candidates.map((p) => p.username),
      ["albait.kw", "albait.sweets"],
    );
    assert.equal(pagesWithoutInstagram, 1);
    const options = candidates.map(toPageOption);
    assert.ok(options.every((o) => !("pageToken" in o)));
    assert.ok(!JSON.stringify(options).includes("EAApageTOKEN"));
  });

  it("no Page with an Instagram account → no candidates (friendly help screen)", async () => {
    for (const fixture of ["meAccountsNone", "meAccountsEmpty"]) {
      const { client: c } = pages(fixture);
      const { candidates } = await listPages(c, "EAAuser");
      assert.equal(candidates.length, 0, fixture);
    }
  });
});
