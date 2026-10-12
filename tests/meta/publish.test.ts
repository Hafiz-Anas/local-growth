import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MetaApiError } from "../../lib/services/meta/errors";
import { appsecretProof } from "../../lib/services/meta/graph";
import { MetaPublishError, isPublicHttpsUrl, publishImage } from "../../lib/services/meta/publish";
import { CONFIG, client, err, ok, type RecordedCall } from "./helpers";

const TOKEN = "page-token-not-real";
const IMAGE = "https://store.public.blob.vercel-storage.com/ig-publish/5b0c1d7e-2f0a-4c55-9d2e-7c1b0d3e9a11.jpg";
const post = { imageUrl: IMAGE, caption: "Fresh batch ☕ #coffee" };

/** Fake clock that only moves when the code sleeps. */
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

const isContainerCreate = (c: RecordedCall) => c.method === "POST" && c.path === "17841400000000001/media";
const isStatus = (c: RecordedCall) => c.method === "GET" && c.path === "17990000000000001";
const isPublish = (c: RecordedCall) => c.method === "POST" && c.path === "17841400000000001/media_publish";

async function rejectsWith(promise: Promise<unknown>, check: (e: unknown) => boolean) {
  await assert.rejects(promise, (e) => {
    assert.ok(check(e), `unexpected error: ${(e as Error)?.message}`);
    return true;
  });
}

describe("publishImage", () => {
  it("creates the container, waits for FINISHED, then publishes it", async () => {
    let checks = 0;
    const { client: c, calls } = client((call) => {
      if (isContainerCreate(call)) return ok({ id: "17990000000000001" });
      if (isStatus(call)) return ok({ status_code: ++checks < 3 ? "IN_PROGRESS" : "FINISHED", id: "17990000000000001" });
      if (isPublish(call)) return ok({ id: "17900000000000099" });
      return err({ error: { message: "unexpected", code: 100 } });
    });
    const time = clock();
    const result = await publishImage(c, "17841400000000001", TOKEN, post, { now: time.now, sleep: time.sleep });
    assert.deepEqual(result, { mediaId: "17900000000000099", containerId: "17990000000000001" });

    const create = calls.find(isContainerCreate)!;
    assert.equal(create.params.get("image_url"), IMAGE);
    assert.equal(create.params.get("caption"), post.caption);
    assert.equal(create.params.get("appsecret_proof"), appsecretProof(TOKEN, CONFIG.appSecret));
    assert.equal(calls.filter(isStatus).length, 3);
    assert.equal(calls.filter(isStatus)[0].params.get("fields"), "status_code,status");
    assert.equal(calls.find(isPublish)!.params.get("creation_id"), "17990000000000001");
    // Each POST is sent exactly once.
    assert.equal(calls.filter(isContainerCreate).length, 1);
    assert.equal(calls.filter(isPublish).length, 1);
  });

  it("fails with media_rejected when the container errors, and never publishes", async () => {
    const { client: c, calls } = client((call) => {
      if (isContainerCreate(call)) return ok({ id: "17990000000000001" });
      if (isStatus(call)) return ok({ status_code: "ERROR", status: "Error: Media type not supported" });
      return ok({ id: "x" });
    });
    const time = clock();
    await rejectsWith(publishImage(c, "17841400000000001", TOKEN, post, time), (e) => e instanceof MetaPublishError && e.reason === "media_rejected" && e.detail.includes("not supported"));
    assert.equal(calls.filter(isPublish).length, 0);
  });

  it("gives up with processing_timeout when the container never finishes", async () => {
    const { client: c, calls } = client((call) => (isContainerCreate(call) ? ok({ id: "17990000000000001" }) : ok({ status_code: "IN_PROGRESS" })));
    const time = clock();
    await rejectsWith(publishImage(c, "17841400000000001", TOKEN, post, { ...time, timeoutMs: 10_000, pollIntervalMs: 2_000 }), (e) => e instanceof MetaPublishError && e.reason === "processing_timeout");
    assert.ok(calls.filter(isStatus).length <= 7);
    assert.equal(calls.filter(isPublish).length, 0);
  });

  it("maps publish-specific Graph errors", async () => {
    const cases: Array<[object, string]> = [
      [{ message: "The media could not be fetched from this uri", code: 9004, error_subcode: 2207052 }, "image_unreachable"],
      [{ message: "The aspect ratio is not supported.", code: 36003, error_subcode: 2207009 }, "media_rejected"],
      [{ message: "Application request limit reached", code: 9, error_subcode: 2207042 }, "daily_limit"],
    ];
    for (const [error, reason] of cases) {
      const { client: c } = client(() => err({ error }));
      await rejectsWith(publishImage(c, "17841400000000001", TOKEN, post, clock()), (e) => e instanceof MetaPublishError && e.reason === reason);
    }
  });

  it("leaves token, permission and rate-limit errors to the generic handling", async () => {
    const cases: Array<[object, string]> = [
      [{ message: "Error validating access token: Session has expired", code: 190, error_subcode: 463 }, "token_invalid"],
      [{ message: "(#10) Application does not have permission for this action", code: 10 }, "permission"],
      [{ message: "(#4) Application request limit reached", code: 4 }, "rate_limited"],
    ];
    for (const [error, kind] of cases) {
      const { client: c } = client(() => err({ error }, kind === "token_invalid" ? 401 : 400));
      await rejectsWith(publishImage(c, "17841400000000001", TOKEN, post, clock()), (e) => e instanceof MetaApiError && e.kind === kind);
    }
  });

  it("reports an unanswered publish call as uncertain (it may have gone out)", async () => {
    const { client: c } = client((call) => {
      if (isContainerCreate(call)) return ok({ id: "17990000000000001" });
      if (isStatus(call)) return ok({ status_code: "FINISHED" });
      return err({ error: { message: "Service temporarily unavailable", code: 2 } }, 503);
    });
    await rejectsWith(publishImage(c, "17841400000000001", TOKEN, post, clock()), (e) => e instanceof MetaPublishError && e.reason === "uncertain");
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
