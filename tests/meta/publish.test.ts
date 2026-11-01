import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MetaApiError } from "../../lib/services/meta/errors";
import { appsecretProof } from "../../lib/services/meta/graph";
import {
  CAROUSEL_MAX,
  MetaPublishError,
  captionProblem,
  createCarouselContainer,
  createImageContainer,
  fetchPublishingLimit,
  fetchRecentMedia,
  getContainerStatus,
  isPublicHttpsUrl,
  matchPublishedMedia,
  publishContainer,
} from "../../lib/services/meta/publish";
import { CONFIG, client, err, ok, type RecordedCall } from "./helpers";

const IG_USER = "17841400000000001";
const TOKEN = "page-token-not-real";
const IMAGE = "https://store.public.blob.vercel-storage.com/ig-publish/5b0c1d7e-2f0a-4c55-9d2e-7c1b0d3e9a11.jpg";
const IMAGE_2 = "https://store.public.blob.vercel-storage.com/ig-publish/6c1d2e8f-3a1b-4d66-8e3f-8d2c1e4f0b22.jpg";

const isContainerCreate = (c: RecordedCall) => c.method === "POST" && c.path === `${IG_USER}/media`;
const isStatus = (c: RecordedCall) => c.method === "GET" && c.path === "17990000000000001";
const isPublish = (c: RecordedCall) => c.method === "POST" && c.path === `${IG_USER}/media_publish`;

async function rejectsWith(promise: Promise<unknown>, check: (e: unknown) => boolean) {
  await assert.rejects(promise, (e) => {
    assert.ok(check(e), `unexpected error: ${(e as Error)?.message}`);
    return true;
  });
}

describe("publishing steps (Graph API)", () => {
  it("a single photo: container with image and caption, sent once with appsecret_proof", async () => {
    const { client: c, calls } = client(() => ok({ id: "17990000000000001" }));
    const id = await createImageContainer(c, IG_USER, TOKEN, { imageUrl: IMAGE, caption: "Fresh batch ☕ #coffee" });
    assert.equal(id, "17990000000000001");
    const create = calls.find(isContainerCreate)!;
    assert.equal(create.params.get("image_url"), IMAGE);
    assert.equal(create.params.get("caption"), "Fresh batch ☕ #coffee");
    assert.equal(create.params.get("is_carousel_item"), null);
    assert.equal(create.params.get("appsecret_proof"), appsecretProof(TOKEN, CONFIG.appSecret));
    assert.equal(calls.length, 1);
  });

  it("a carousel: children without a caption, then the carousel with children in order and the caption", async () => {
    let n = 0;
    const { client: c, calls } = client(() => ok({ id: `1799000000000000${++n}` }));
    const a = await createImageContainer(c, IG_USER, TOKEN, { imageUrl: IMAGE, carouselItem: true });
    const b = await createImageContainer(c, IG_USER, TOKEN, { imageUrl: IMAGE_2, carouselItem: true });
    const parent = await createCarouselContainer(c, IG_USER, TOKEN, { childIds: [a, b], caption: "Two new cakes" });
    assert.equal(parent, "17990000000000003");
    assert.equal(calls[0].params.get("is_carousel_item"), "true");
    assert.equal(calls[0].params.get("caption"), null);
    assert.equal(calls[1].params.get("image_url"), IMAGE_2);
    assert.equal(calls[2].params.get("media_type"), "CAROUSEL");
    assert.equal(calls[2].params.get("children"), `${a},${b}`);
    assert.equal(calls[2].params.get("caption"), "Two new cakes");
    assert.equal(CAROUSEL_MAX, 20);
  });

  it("reads a container's status_code; missing means still in progress", async () => {
    const answers = [{ status_code: "FINISHED" }, { status_code: "PUBLISHED" }, { status_code: "ERROR", status: "Error: Media type not supported" }, {}];
    let i = 0;
    const { client: c, calls } = client(() => ok(answers[i++]));
    assert.deepEqual(await getContainerStatus(c, "17990000000000001", TOKEN), { code: "FINISHED", detail: "" });
    assert.deepEqual(await getContainerStatus(c, "17990000000000001", TOKEN), { code: "PUBLISHED", detail: "" });
    assert.deepEqual(await getContainerStatus(c, "17990000000000001", TOKEN), { code: "ERROR", detail: "Error: Media type not supported" });
    assert.deepEqual(await getContainerStatus(c, "17990000000000001", TOKEN), { code: "IN_PROGRESS", detail: "" });
    assert.equal(calls.filter(isStatus)[0].params.get("fields"), "status_code,status");
  });

  it("publishes a container once and returns the media id", async () => {
    const { client: c, calls } = client(() => ok({ id: "17900000000000099" }));
    assert.equal(await publishContainer(c, IG_USER, TOKEN, "17990000000000001"), "17900000000000099");
    assert.equal(calls.find(isPublish)!.params.get("creation_id"), "17990000000000001");
    assert.equal(calls.length, 1);
  });

  it("an unanswered publish call is uncertain (it may have gone out) and is never retried here", async () => {
    const { client: c, calls } = client(() => err({ error: { message: "Service temporarily unavailable", code: 2 } }, 503));
    await rejectsWith(publishContainer(c, IG_USER, TOKEN, "17990000000000001"), (e) => e instanceof MetaPublishError && e.reason === "uncertain");
    assert.equal(calls.filter(isPublish).length, 1);
  });

  it("an unanswered container call is a network error (a new container is safe)", async () => {
    const { client: c, calls } = client(() => err({ error: { message: "Service temporarily unavailable", code: 2 } }, 503));
    await rejectsWith(createImageContainer(c, IG_USER, TOKEN, { imageUrl: IMAGE, caption: "x" }), (e) => e instanceof MetaPublishError && e.reason === "network");
    assert.equal(calls.filter(isContainerCreate).length, 1);
  });

  it("maps publish-specific Graph errors", async () => {
    const cases: Array<[object, string]> = [
      [{ message: "The media could not be fetched from this uri", code: 9004, error_subcode: 2207052 }, "image_unreachable"],
      [{ message: "The aspect ratio is not supported.", code: 36003, error_subcode: 2207009 }, "media_rejected"],
      [{ message: "Application request limit reached", code: 9, error_subcode: 2207042 }, "daily_limit"],
    ];
    for (const [error, reason] of cases) {
      const { client: c } = client(() => err({ error }));
      await rejectsWith(createImageContainer(c, IG_USER, TOKEN, { imageUrl: IMAGE, caption: "x" }), (e) => e instanceof MetaPublishError && e.reason === reason);
    }
    const { client: c } = client(() => err({ error: { message: "Application request limit reached", code: 9, error_subcode: 2207042 } }));
    await rejectsWith(publishContainer(c, IG_USER, TOKEN, "1"), (e) => e instanceof MetaPublishError && e.reason === "daily_limit");
  });

  it("leaves token, permission and rate-limit errors to the generic handling", async () => {
    const cases: Array<[object, string]> = [
      [{ message: "Error validating access token: Session has expired", code: 190, error_subcode: 463 }, "token_invalid"],
      [{ message: "(#10) Application does not have permission for this action", code: 10 }, "permission"],
      [{ message: "(#4) Application request limit reached", code: 4 }, "rate_limited"],
    ];
    for (const [error, kind] of cases) {
      const { client: c } = client(() => err({ error }, kind === "token_invalid" ? 401 : 400));
      await rejectsWith(publishContainer(c, IG_USER, TOKEN, "1"), (e) => e instanceof MetaApiError && e.kind === kind);
    }
  });

  it("reads the daily publishing limit (null when Meta doesn't say)", async () => {
    const { client: c, calls } = client(() => ok({ data: [{ quota_usage: 3, config: { quota_total: 50, quota_duration: 86400 } }] }));
    assert.deepEqual(await fetchPublishingLimit(c, IG_USER, TOKEN), { used: 3, total: 50 });
    assert.equal(calls[0].path, `${IG_USER}/content_publishing_limit`);
    assert.equal(calls[0].params.get("fields"), "quota_usage,config");
    const { client: empty } = client(() => ok({ data: [] }));
    assert.equal(await fetchPublishingLimit(empty, IG_USER, TOKEN), null);
  });
});

describe("finding the post an unclear publish call made", () => {
  const since = new Date("2026-11-01T10:00:00Z");
  const media = [
    { id: "a", caption: "Other post", timestamp: "2026-11-01T10:01:00+0000", permalink: "https://www.instagram.com/p/a/" },
    { id: "b", caption: "Two new  cakes\n#bakery", timestamp: "2026-11-01T10:00:30+0000", permalink: "https://www.instagram.com/p/b/" },
    { id: "c", caption: "Two new cakes #bakery", timestamp: "2026-10-30T10:00:00+0000", permalink: null },
  ];

  it("matches the caption (spaces normalised) posted since the publish call", () => {
    assert.equal(matchPublishedMedia(media, "Two new cakes #bakery", since)?.id, "b");
  });

  it("ignores older posts with the same caption, and returns null when nothing matches", () => {
    assert.equal(matchPublishedMedia(media.filter((m) => m.id !== "b"), "Two new cakes #bakery", since), null);
    assert.equal(matchPublishedMedia(media, "Something else", since), null);
  });

  it("reads the newest posts with caption, time and link", async () => {
    const { client: c, calls } = client(() => ok({ data: [{ id: "b", caption: "x", timestamp: "2026-11-01T10:00:30+0000", permalink: "https://www.instagram.com/p/b/" }] }));
    assert.deepEqual(await fetchRecentMedia(c, IG_USER, TOKEN, 10), [{ id: "b", caption: "x", timestamp: "2026-11-01T10:00:30+0000", permalink: "https://www.instagram.com/p/b/" }]);
    assert.equal(calls[0].params.get("fields"), "id,caption,timestamp,permalink");
    assert.equal(calls[0].params.get("limit"), "10");
  });
});

describe("captionProblem (Meta: 2,200 characters, 30 hashtags, 20 @mentions)", () => {
  it("accepts a normal caption and refuses each limit", () => {
    assert.equal(captionProblem("Fresh batch ☕ #coffee @friend"), null);
    assert.equal(captionProblem("x".repeat(2201)), "caption_too_long");
    assert.equal(captionProblem(Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ")), "too_many_hashtags");
    assert.equal(captionProblem(Array.from({ length: 21 }, (_, i) => `@u${i}`).join(" ")), "too_many_mentions");
    assert.equal(captionProblem("write to hello@shop.com"), null);
  });
});

describe("isPublicHttpsUrl", () => {
  it("accepts public HTTPS only", () => {
    assert.equal(isPublicHttpsUrl(IMAGE), true);
    assert.equal(isPublicHttpsUrl("/api/uploads/post-images/a.png"), false);
    assert.equal(isPublicHttpsUrl("http://example.com/a.jpg"), false);
    assert.equal(isPublicHttpsUrl("https://localhost:3000/a.jpg"), false);
    assert.equal(isPublicHttpsUrl(null), false);
  });
});
