import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { businessDiscovery, fetchAccountInsights, fetchPostInsights } from "../../lib/services/meta/api";
import { MetaApiError } from "../../lib/services/meta/errors";
import { accountMetric, engagementMetric, followerGrowthMetric, followerSeries, heatmapOf, opportunityOf, windowResults } from "../../lib/services/meta/insights";
import { businessDiscoveryFields, displayUrl, engagementRateOf, mapDiscoveryOutcome, postsPerWeekOf, type AccountInsights } from "../../lib/services/meta/mappers";
import { client, err, fx, ok } from "./helpers";

const OWN = { username: "albait.kw", igUserId: "17841400000000001" };
const NOW = Date.parse("2026-10-08T12:00:00Z");

describe("business discovery → competitor status", () => {
  it("public business account → ready, with engagement and posts", async () => {
    const { client: c, calls } = client(() => ok(fx.businessDiscoveryReady));
    const result = await businessDiscovery(c, OWN.igUserId, "EAApage", "rival.cafe");
    const { status, profile } = mapDiscoveryOutcome("rival.cafe", { result }, OWN);
    assert.equal(status, "ready");
    assert.equal(profile?.followers, 10000);
    assert.equal(profile?.mediaCount, 340);
    // (320 + 160 + 50) / 3 posts / 10000 followers = 1.77% → 1.8
    assert.equal(profile?.engagementRate, 1.8);
    assert.equal(profile?.posts[1].mediaUrl, "https://scontent.cdninstagram.com/v/2.jpg"); // video → thumbnail
    assert.match(calls[0].params.get("fields")!, /^business_discovery\.username\(rival\.cafe\)\{/);
  });

  it("110/2207013 (doesn't exist, or a personal/private account) → not_found", () => {
    const error = MetaApiError.fromGraph("GET /{ig-user}?fields=business_discovery", (fx.errorBusinessDiscoveryNotFound as { error: object }).error, 400);
    assert.equal(mapDiscoveryOutcome("nosuchshop.kw", { error }, OWN).status, "not_found");
  });

  it("own account → own_account (by handle, before calling, and by returned id)", () => {
    assert.equal(mapDiscoveryOutcome("AlBait.KW", { result: {} }, OWN).status, "own_account");
    const sameId = { business_discovery: { id: OWN.igUserId, username: "renamed", followers_count: 5 } };
    assert.equal(mapDiscoveryOutcome("renamed", { result: sameId }, OWN).status, "own_account");
  });

  it("token, permission and rate-limit errors are thrown, not mistaken for a status", () => {
    for (const key of ["errorTokenExpired", "errorPermission", "errorRateLimit"]) {
      const error = MetaApiError.fromGraph("GET /{ig-user}?fields=business_discovery", (fx[key] as { error: object }).error, 400);
      assert.throws(() => mapDiscoveryOutcome("rival.cafe", { error }, OWN), MetaApiError, key);
    }
  });

  it("only safe characters reach the field expansion", () => {
    assert.equal(businessDiscoveryFields("evil){id}", 3).startsWith("business_discovery.username(evilid)"), true);
  });

  it("engagement and posting frequency", () => {
    assert.equal(engagementRateOf([], 100), 0);
    assert.equal(engagementRateOf([{ likes: 10, comments: 0 }], 0), 0);
    assert.equal(postsPerWeekOf(["2026-10-01T00:00:00Z", "2026-10-04T00:00:00Z", "2026-10-07T00:00:00Z"], Date.parse("2026-10-08T00:00:00Z")), 3);
  });
});

describe("account insights", () => {
  const insights = (route: (metric: string, period: string | null) => ReturnType<typeof ok>) =>
    client(({ path, params }) => (path.endsWith("/insights") ? route(params.get("metric")!, params.get("period")) : err({ error: { code: 100 } })));

  it("all metrics: current, previous, follower_count and online_followers", async () => {
    const { client: c } = insights((metric) => {
      if (metric === "follower_count") return ok(fx.insightsFollowerCount);
      if (metric === "online_followers") return ok(fx.insightsOnlineFollowers);
      return ok(fx.insightsAccountTotal);
    });
    const result = await fetchAccountInsights(c, "17841400000000001", "EAApage", NOW);
    assert.equal(result.current.reach, 5200);
    assert.equal(result.previous.reach, 5200);
    assert.deepEqual(result.followerDaily, [
      { date: "2026-10-05", value: 4 },
      { date: "2026-10-06", value: 7 },
      { date: "2026-10-07", value: 2 },
    ]);
    assert.ok(result.onlineFollowers);
    // profile_views isn't in the sample response: reported, not invented.
    assert.deepEqual(result.unavailable, [{ metric: "profile_views", reason: "missing" }]);
  });

  it("an unsupported metric fails the batch → asked one by one; small accounts lose follower metrics", async () => {
    const { client: c, calls } = insights((metric) => {
      if (metric.includes(",")) return err(fx.errorInvalidMetric);
      if (metric === "profile_views") return err(fx.errorInvalidMetric);
      if (metric === "follower_count" || metric === "online_followers") return err(fx.errorFollowerCountSmall);
      const one = (fx.insightsAccountTotal as { data: Array<{ name: string }> }).data.filter((d) => d.name === metric);
      return ok({ data: one });
    });
    const result = await fetchAccountInsights(c, "17841400000000001", "EAApage", NOW);
    assert.equal(result.current.views, 18400);
    assert.equal(result.current.profile_views, undefined);
    assert.equal(result.followerDaily, null);
    assert.equal(result.onlineFollowers, null);
    const unavailable = result.unavailable.map((u) => u.metric).sort();
    assert.deepEqual(unavailable, ["follower_count", "online_followers", "profile_views"]);
    assert.ok(result.unavailable.every((u) => u.reason.startsWith("invalid_request:100")));
    assert.ok(calls.length > 6);
  });

  it("insights permission not granted → every metric unavailable, the sync goes on", async () => {
    const { client: c } = insights(() => err(fx.errorPermissionUnnamed, 403));
    const result = await fetchAccountInsights(c, "17841400000000001", "EAApage", NOW);
    assert.deepEqual(result.current, {});
    assert.ok(result.unavailable.length >= 6);
    assert.ok(result.unavailable.every((u) => u.reason.startsWith("permission")));
  });

  it("an expired token stops the sync", async () => {
    const { client: c } = insights(() => err(fx.errorTokenExpired));
    await assert.rejects(fetchAccountInsights(c, "17841400000000001", "EAApage", NOW), (e: unknown) => e instanceof MetaApiError && e.kind === "token_invalid");
  });

  it("post insights fall back to the minimal metric set, then report unavailable", async () => {
    const minimal = client(({ params }) => (params.get("metric")!.includes("views") ? err(fx.errorInvalidMetric) : ok(fx.insightsPost)));
    assert.deepEqual((await fetchPostInsights(minimal.client, "17900000000000001", "EAApage")).values, { reach: 900, saved: 31 });
    const none = client(() => err(fx.errorInvalidMetric));
    const result = await fetchPostInsights(none.client, "17900000000000001", "EAApage");
    assert.equal(result.values, null);
    assert.match(result.reason ?? "", /invalid_request/);
  });
});

describe("dashboard numbers from synced data", () => {
  const empty: AccountInsights = { current: {}, previous: {}, followerDaily: null, onlineFollowers: null, unavailable: [], syncedAt: "" };
  const day = 24 * 60 * 60 * 1000;
  const post = (daysAgo: number, likes: number, comments: number, reach?: number, hourUtc = 15) => {
    const d = new Date(NOW - daysAgo * day);
    d.setUTCHours(hourUtc, 0, 0, 0);
    const insights: Record<string, number> = reach === undefined ? {} : { reach };
    return { postedAt: d, likes, comments, insights };
  };

  it("missing metrics are marked unavailable instead of showing 0", () => {
    assert.deepEqual(accountMetric(null, "reach"), { value: 0, changePct: 0, available: false });
    assert.deepEqual(accountMetric({ ...empty, current: { reach: 120 }, previous: { reach: 100 } }, "reach"), { value: 120, changePct: 20 });
    assert.equal(engagementMetric([], 1000, NOW).available, false);
    assert.equal(followerGrowthMetric(empty, [], NOW).available, false);
    assert.equal(followerGrowthMetric(empty, [{ date: "2026-10-08", followers: 50 }], NOW).available, false);
  });

  it("follower growth from Meta's daily counts, else from our snapshots", () => {
    assert.deepEqual(followerGrowthMetric({ ...empty, followerDaily: [{ date: "2026-10-07", value: 3 }, { date: "2026-10-08", value: 4 }] }, [], NOW), { value: 7, changePct: 0 });
    const snaps = [
      { date: "2026-10-01", followers: 90 },
      { date: "2026-10-08", followers: 96 },
    ];
    assert.deepEqual(followerGrowthMetric(empty, snaps, NOW), { value: 6, changePct: 0 });
  });

  it("follower chart: snapshots, back-filled from daily counts while history is short", () => {
    const series = followerSeries([{ date: "2026-10-07", followers: 1840 }], { ...empty, followerDaily: [{ date: "2026-10-05", value: 4 }, { date: "2026-10-06", value: 7 }, { date: "2026-10-07", value: 2 }] }, 1840);
    assert.deepEqual(series, [
      { date: "2026-10-05", followers: 1831 },
      { date: "2026-10-06", followers: 1838 },
      { date: "2026-10-07", followers: 1840 },
    ]);
  });

  it("engagement rate over 30 days vs the 30 before", () => {
    const m = engagementMetric([post(2, 90, 10), post(40, 45, 5)], 1000, NOW);
    assert.deepEqual(m, { value: 10, changePct: 100 });
  });

  it("windows, baseline and opportunity in the business's time zone", () => {
    // 15:00 UTC = 18:00 Kuwait → evening; 06:00 UTC = 09:00 Kuwait → morning.
    const posts = [post(1, 0, 0, 300, 15), post(3, 0, 0, 300, 15), post(5, 0, 0, 300, 15), post(2, 0, 0, 100, 6), post(4, 0, 0, 100, 6)];
    const { baselineReach, windows } = windowResults(posts, "Asia/Kuwait", NOW);
    assert.equal(baselineReach, 220);
    const evening = windows.find((w) => w.id === "evening")!;
    assert.equal(evening.postsSampled, 3);
    assert.equal(evening.avgReach, 300);
    assert.equal(windows.find((w) => w.id === "morning")!.postsSampled, 2);
    assert.deepEqual(opportunityOf(windows), { window: "evening", liftPct: 36, sampleSize: 3, confidencePct: 65 });
    assert.equal(opportunityOf(windowResults(posts.slice(3), "Asia/Kuwait", NOW).windows), null);
  });

  it("heatmap: online followers when available, else engagement on own posts", () => {
    const grid = heatmapOf({ ...empty, onlineFollowers: [[0, 2, ...Array(22).fill(0)], ...Array.from({ length: 6 }, () => Array(24).fill(1))] }, [], "Asia/Kuwait");
    assert.equal(grid[0][1], 1);
    assert.equal(grid[1][0], 0.5);
    const fromPosts = heatmapOf(null, [post(1, 10, 0, undefined, 15)], "Asia/Kuwait");
    assert.equal(fromPosts.flat().filter((v) => v > 0).length, 1);
  });

  it("video posts show their thumbnail", () => {
    assert.equal(displayUrl({ mediaType: "VIDEO", mediaUrl: "v.mp4", thumbnailUrl: "t.jpg" }), "t.jpg");
    assert.equal(displayUrl({ mediaType: "IMAGE", mediaUrl: "i.jpg", thumbnailUrl: null }), "i.jpg");
  });
});
