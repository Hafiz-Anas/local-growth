import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchMedia, fetchProfile, postCommentReply } from "../../lib/services/meta/api";
import { classifyGraphError, MetaApiError, sanitize } from "../../lib/services/meta/errors";
import { appsecretProof, parseUsageHeaders } from "../../lib/services/meta/graph";
import { CONFIG, client, err, fx, ok } from "./helpers";

const body = (key: string) => (fx[key] as { error: object }).error;

describe("error classification", () => {
  it("maps Meta's codes to what the app does", () => {
    assert.equal(classifyGraphError(body("errorTokenExpired")), "token_invalid");
    assert.equal(classifyGraphError(body("errorTokenRevoked")), "token_invalid");
    assert.equal(classifyGraphError(body("errorRateLimit")), "rate_limited");
    assert.equal(classifyGraphError(body("errorBucRateLimit")), "rate_limited");
    for (const code of [4, 17, 32, 613]) assert.equal(classifyGraphError({ code }), "rate_limited", `code ${code}`);
    assert.equal(classifyGraphError(body("errorPermission")), "permission");
    assert.equal(classifyGraphError(body("errorPermissionUnnamed")), "permission");
    assert.equal(classifyGraphError(body("errorBusinessDiscoveryNotFound")), "not_found");
    assert.equal(classifyGraphError(body("errorInvalidMetric")), "invalid_request");
    assert.equal(classifyGraphError(body("errorServer")), "transient");
    assert.equal(classifyGraphError({ code: 999 }, 503), "transient");
  });

  it("names the missing permission (from the message, else from the call)", () => {
    const named = MetaApiError.fromGraph("POST /{ig-comment}/replies", body("errorPermission"), 403, ["instagram_basic"]);
    assert.deepEqual(named.missingScopes, ["instagram_manage_comments"]);
    const unnamed = MetaApiError.fromGraph("GET /{ig-user}/insights", body("errorPermissionUnnamed"), 403, ["instagram_manage_insights"]);
    assert.deepEqual(unnamed.missingScopes, ["instagram_manage_insights"]);
  });

  it("never keeps a token in messages", () => {
    const text = sanitize("bad https://graph.facebook.com/v26.0/me?access_token=EAAabcdefghijklmnopqrstuvwxyz123&appsecret_proof=abc token EAAGm0PX4ZCpsBAxxxxxxxxxxxxxxxxxxxx");
    assert.ok(!text.includes("EAAabcdefghijklmnop"));
    assert.ok(!text.includes("EAAGm0PX4ZCpsBA"));
    assert.match(text, /access_token=\[redacted\]/);
    assert.match(text, /appsecret_proof=\[redacted\]/);
  });
});

describe("usage headers", () => {
  it("reads X-App-Usage and X-Business-Use-Case-Usage", () => {
    const usage = parseUsageHeaders(
      new Headers({
        "x-app-usage": JSON.stringify({ call_count: 12, total_time: 30, total_cputime: 8 }),
        "x-business-use-case-usage": JSON.stringify({ "17841400000000001": [{ type: "instagram", call_count: 95, total_cputime: 10, total_time: 20, estimated_time_to_regain_access: 7 }] }),
      }),
    );
    assert.deepEqual(usage, { appPct: 30, businessPct: 95, regainAccessMinutes: 7 });
    assert.equal(parseUsageHeaders(new Headers()), null);
    assert.equal(parseUsageHeaders(new Headers({ "x-app-usage": "not json" })), null);
  });
});

describe("GraphClient", () => {
  it("signs calls with appsecret_proof = HMAC-SHA256(token, secret)", async () => {
    const { client: c, calls } = client(() => ok(fx.profile));
    const profile = await fetchProfile(c, "17841400000000001", "EAApage");
    assert.equal(profile.username, "albait.kw");
    assert.equal(profile.follows, 310);
    assert.equal(calls[0].params.get("appsecret_proof"), appsecretProof("EAApage", CONFIG.appSecret));
    assert.equal(appsecretProof("EAApage", CONFIG.appSecret).length, 64);
  });

  it("expired token (190): fails at once, no retries, reported as token_invalid", async () => {
    const { client: c, calls, sleeps, infos } = client(() => err(fx.errorTokenExpired, 400));
    await assert.rejects(fetchProfile(c, "17841400000000001", "EAAold"), (e: unknown) => e instanceof MetaApiError && e.kind === "token_invalid" && e.codeLabel === "190/463");
    assert.equal(calls.length, 1);
    assert.deepEqual(sleeps, []);
    assert.equal(infos[0].ok, false);
    assert.equal(infos[0].error?.kind, "token_invalid");
    assert.equal(infos[0].call, "GET /{ig-user}");
    // The call name never contains ids or tokens.
    assert.ok(!infos[0].call.includes("1784") && !infos[0].call.includes("EAA"));
  });

  it("rate limit (4): backs off and retries, then succeeds", async () => {
    const { client: c, calls, sleeps } = client((_call, n) => (n < 3 ? err(fx.errorRateLimit, 400) : ok(fx.profile)));
    const profile = await fetchProfile(c, "17841400000000001", "EAApage");
    assert.equal(profile.followers, 1840);
    assert.equal(calls.length, 3);
    assert.deepEqual(sleeps, [1000, 4000]);
  });

  it("rate limit with a long wait from Meta: no inline waiting, the error carries retryAfterMs", async () => {
    const headers = { "x-business-use-case-usage": JSON.stringify({ "1": [{ call_count: 100, estimated_time_to_regain_access: 30 }] }) };
    const { client: c, calls, sleeps } = client(() => err(fx.errorBucRateLimit, 400, headers));
    await assert.rejects(fetchProfile(c, "17841400000000001", "EAApage"), (e: unknown) => e instanceof MetaApiError && e.kind === "rate_limited" && e.retryAfterMs === 30 * 60_000);
    assert.equal(calls.length, 1);
    assert.deepEqual(sleeps, []);
  });

  it("gives up after the retries", async () => {
    const { client: c, calls } = client(() => err(fx.errorRateLimit, 400));
    await assert.rejects(fetchProfile(c, "1", "EAApage"), (e: unknown) => e instanceof MetaApiError && e.kind === "rate_limited");
    assert.equal(calls.length, 3);
  });

  it("quiet calls mark expected 'not found' answers, but never hide token/permission/rate errors", async () => {
    const opts = { call: "GET /{ig-user}/insights", token: "EAApage", quiet: true };
    const notFound = client(() => err(fx.errorInvalidMetric));
    await assert.rejects(notFound.client.get("1/insights", {}, opts));
    assert.equal(notFound.infos[0].expected, true);
    for (const key of ["errorTokenExpired", "errorPermission"]) {
      const serious = client(() => err(fx[key]));
      await assert.rejects(serious.client.get("1/insights", {}, opts));
      assert.equal(serious.infos[0].expected, false, key);
    }
  });

  it("POSTs (reply to a comment) are never retried — no double replies", async () => {
    const { client: c, calls } = client(() => err(fx.errorServer, 500));
    await assert.rejects(postCommentReply(c, "18000000000000001", "EAApage", "Thank you!"), (e: unknown) => e instanceof MetaApiError && e.kind === "transient");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].params.get("message"), "Thank you!");
  });

  it("follows cursors and re-signs each page instead of reusing Meta's `next` URL", async () => {
    const { client: c, calls } = client(({ params }) => ok(params.get("after") ? fx.mediaPage2 : fx.mediaPage1));
    const media = await fetchMedia(c, "17841400000000001", "EAApage", 50);
    assert.deepEqual(
      media.map((m) => m.igMediaId),
      ["17900000000000001", "17900000000000002", "17900000000000003"],
    );
    assert.equal(calls.length, 2);
    assert.equal(calls[1].params.get("after"), "QVFIb");
    assert.ok(calls.every((call) => call.params.get("appsecret_proof")));
    const reel = media[1];
    assert.equal(reel.mediaType, "VIDEO");
    assert.equal(reel.mediaProductType, "REELS");
    assert.equal(reel.thumbnailUrl, "https://scontent.cdninstagram.com/v/m2.jpg");
    assert.equal(reel.caption, "");
  });
});
