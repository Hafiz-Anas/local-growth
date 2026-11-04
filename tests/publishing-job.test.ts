import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PUBLISH_MAX_ATTEMPTS,
  PUBLISH_MAX_LATE_MS,
  afterFailure,
  isMissed,
  nextStep,
  onContainerStatus,
  DELAYED_REASON,
  STALLED_AFTER_MS,
  publishStateOf,
  publishViewOf,
  type JobShape,
  type PublishJobView,
} from "../lib/publishing/job";
import { cropToRatio, instagramRatio } from "../lib/services/images/instagram-fit";

const NOW = new Date("2026-11-01T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const job = (over: Partial<{ scheduledFor: Date; attempts: number; publishCalled: boolean }> = {}) => ({ scheduledFor: ago(60_000), attempts: 0, publishCalled: false, ...over });

describe("afterFailure: limited retries, waiting, final", () => {
  it("retries temporary problems with growing waits, then fails", () => {
    const first = afterFailure(job(), "rate_limited", NOW);
    assert.equal(first.kind, "retry");
    assert.equal(first.kind === "retry" && first.at.getTime() - NOW.getTime(), 2 * 60_000);
    const third = afterFailure(job({ attempts: 2 }), "network", NOW);
    assert.equal(third.kind === "retry" && third.at.getTime() - NOW.getTime(), 15 * 60_000);
    assert.deepEqual(afterFailure(job({ attempts: PUBLISH_MAX_ATTEMPTS - 1 }), "network", NOW), { kind: "fail", reason: "network" });
  });

  it("an unclear publish is retried (by checking first), and fails as uncertain after the last attempt", () => {
    assert.equal(afterFailure(job({ publishCalled: true }), "uncertain", NOW).kind, "retry");
    assert.deepEqual(afterFailure(job({ publishCalled: true, attempts: PUBLISH_MAX_ATTEMPTS - 1 }), "uncertain", NOW), { kind: "fail", reason: "uncertain" });
  });

  it("problems the owner must fix fail at once", () => {
    for (const reason of ["permission", "media_rejected", "image_unreadable", "account_changed", "caption_too_long", "feature_disabled"] as const) {
      assert.deepEqual(afterFailure(job(), reason, NOW), { kind: "fail", reason });
    }
  });

  it("waits for a reconnect or the daily limit without using attempts, up to 6 hours late", () => {
    const hold = afterFailure(job({ attempts: 3 }), "not_connected", NOW);
    assert.equal(hold.kind, "hold");
    assert.equal(hold.kind === "hold" && hold.waiting, "not_connected");
    assert.equal(afterFailure(job(), "daily_limit", NOW).kind, "hold");
    assert.deepEqual(afterFailure(job({ scheduledFor: ago(PUBLISH_MAX_LATE_MS + 1) }), "not_connected", NOW), { kind: "fail", reason: "not_connected" });
  });

  it("once media_publish was sent, a reconnect is waited for however late (the post may be live)", () => {
    assert.equal(afterFailure(job({ scheduledFor: ago(PUBLISH_MAX_LATE_MS * 3), publishCalled: true }), "not_connected", NOW).kind, "hold");
  });
});

describe("isMissed", () => {
  it("a post more than 6 hours late isn't published late, unless publishing was already sent", () => {
    assert.equal(isMissed(job({ scheduledFor: ago(PUBLISH_MAX_LATE_MS - 1000) }), NOW), false);
    assert.equal(isMissed(job({ scheduledFor: ago(PUBLISH_MAX_LATE_MS + 1000) }), NOW), true);
    assert.equal(isMissed(job({ scheduledFor: ago(PUBLISH_MAX_LATE_MS + 1000), publishCalled: true }), NOW), false);
  });
});

describe("onContainerStatus: the duplicate protection", () => {
  const fresh = { fresh: true, processingSince: ago(10_000), now: NOW };
  it("PUBLISHED is posted — never sent again", () => {
    assert.deepEqual(onContainerStatus("PUBLISHED", fresh), { kind: "posted" });
    assert.deepEqual(onContainerStatus("PUBLISHED", { ...fresh, fresh: false }), { kind: "posted" });
  });
  it("FINISHED is published only for this attempt's container; an old one is dropped", () => {
    assert.deepEqual(onContainerStatus("FINISHED", fresh), { kind: "publish" });
    assert.deepEqual(onContainerStatus("FINISHED", { ...fresh, fresh: false }), { kind: "restart" });
  });
  it("EXPIRED starts again (it was never published); ERROR fails as rejected", () => {
    assert.deepEqual(onContainerStatus("EXPIRED", fresh), { kind: "restart" });
    assert.deepEqual(onContainerStatus("ERROR", fresh), { kind: "fail", reason: "media_rejected" });
  });
  it("IN_PROGRESS waits, then times out after 10 minutes", () => {
    assert.deepEqual(onContainerStatus("IN_PROGRESS", fresh), { kind: "wait" });
    assert.deepEqual(onContainerStatus("IN_PROGRESS", { ...fresh, processingSince: ago(11 * 60_000) }), { kind: "fail", reason: "processing_timeout" });
  });
});

describe("nextStep: resumes where the last run stopped", () => {
  const base: JobShape = { format: "IMAGE", photos: 1, childContainerIds: [], containerId: null, publishCalled: false, verifyFirst: false };
  it("single photo: container, then check", () => {
    assert.equal(nextStep(base), "create_container");
    assert.equal(nextStep({ ...base, containerId: "c" }), "check");
  });
  it("carousel: each child, then the carousel, then check", () => {
    const carousel: JobShape = { ...base, format: "CAROUSEL", photos: 3 };
    assert.equal(nextStep(carousel), "create_child");
    assert.equal(nextStep({ ...carousel, childContainerIds: ["a", "b"] }), "create_child");
    assert.equal(nextStep({ ...carousel, childContainerIds: ["a", "b", "c"] }), "create_container");
    assert.equal(nextStep({ ...carousel, childContainerIds: ["a", "b", "c"], containerId: "p" }), "check");
  });
});

describe("publishStateOf: what the owner sees", () => {
  it("maps the job to Scheduled / Waiting / Publishing / Posted / Failed", () => {
    const future = new Date(NOW.getTime() + 3600_000);
    assert.equal(publishStateOf({ status: "SCHEDULED", scheduledFor: future, waitingReason: null }, NOW), "scheduled");
    assert.equal(publishStateOf({ status: "SCHEDULED", scheduledFor: ago(1000), waitingReason: "not_connected" }, NOW), "waiting");
    assert.equal(publishStateOf({ status: "SCHEDULED", scheduledFor: ago(1000), waitingReason: null }, NOW), "publishing");
    assert.equal(publishStateOf({ status: "PUBLISHING", scheduledFor: ago(1000), waitingReason: null }, NOW), "publishing");
    assert.equal(publishStateOf({ status: "PUBLISHED", scheduledFor: ago(1000), waitingReason: null }, NOW), "posted");
    assert.equal(publishStateOf({ status: "FAILED", scheduledFor: ago(1000), waitingReason: null }, NOW), "failed");
  });
});

describe("publishViewOf: a job the scheduler isn't reaching says so", () => {
  const view = (over: Partial<PublishJobView>) =>
    publishViewOf({ status: "SCHEDULED", scheduledFor: ago(60_000), waitingReason: null, failureReason: null, nextAttemptAt: null, updatedAt: ago(2 * 3600_000), ...over }, NOW);

  it("due a minute ago: Publishing (the next run takes it)", () => {
    assert.deepEqual(view({}), { state: "publishing", reason: null });
  });
  it("due 17 hours ago and never picked up: Waiting, delayed — not 'Publishing' forever", () => {
    assert.deepEqual(view({ scheduledFor: ago(17 * 3600_000) }), { state: "waiting", reason: DELAYED_REASON });
  });
  it("started, then nothing saved for longer than a run can hold it: delayed", () => {
    assert.deepEqual(view({ status: "PUBLISHING", scheduledFor: ago(3600_000), updatedAt: ago(STALLED_AFTER_MS + 1000) }), { state: "waiting", reason: DELAYED_REASON });
    assert.deepEqual(view({ status: "PUBLISHING", scheduledFor: ago(3600_000), updatedAt: ago(30_000) }), { state: "publishing", reason: null });
  });
  it("waiting for a later check isn't delayed until that check is overdue", () => {
    const waiting = { status: "PUBLISHING" as const, scheduledFor: ago(3600_000), updatedAt: ago(3600_000), waitingReason: "rate_limited" };
    assert.deepEqual(view({ ...waiting, nextAttemptAt: new Date(NOW.getTime() + 10 * 60_000) }), { state: "waiting", reason: "rate_limited" });
    assert.deepEqual(view({ ...waiting, nextAttemptAt: ago(STALLED_AFTER_MS + 1000) }), { state: "waiting", reason: DELAYED_REASON });
  });
  it("failed shows its reason; upcoming has none", () => {
    assert.deepEqual(view({ status: "FAILED", failureReason: "missed_window" }), { state: "failed", reason: "missed_window" });
    assert.deepEqual(view({ scheduledFor: new Date(NOW.getTime() + 60_000) }), { state: "scheduled", reason: null });
  });
});

describe("carousel shapes", () => {
  it("the cover's ratio is clamped into 4:5–1.91:1", () => {
    assert.equal(instagramRatio(1000, 1000), 1);
    assert.equal(instagramRatio(1000, 2000), 0.8);
    assert.equal(instagramRatio(3000, 1000), 1.91);
  });
  it("the other photos are centre-cropped to the cover's ratio", () => {
    assert.equal(cropToRatio(1000, 1000, 1), null);
    assert.deepEqual(cropToRatio(1000, 1500, 1), { left: 0, top: 250, width: 1000, height: 1000 });
    assert.deepEqual(cropToRatio(2000, 1000, 1), { left: 500, top: 0, width: 1000, height: 1000 });
    assert.deepEqual(cropToRatio(1000, 1000, 0.8), { left: 100, top: 0, width: 800, height: 1000 });
  });
});
