import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_SAVED_INSPIRATION, competitorPostRefs, inspirationStorageKey, parseSavedInspiration } from "../lib/gallery/competitor-posts";

const competitor = {
  id: "c1",
  handle: "brew_lane_kw",
  displayName: null,
  name: "Brew Lane",
  avatarUrl: null,
  recentPosts: [{ id: "p1", tone: "latte" as const, icon: "coffee" as const, likes: 120, comments: 8, notable: false, caption: "New ✨" }],
};
const saved = { ...competitorPostRefs(competitor)[0], savedAt: "2026-10-28T09:00:00.000Z" };

describe("Saved inspiration in the browser", () => {
  it("is kept per business", () => {
    assert.equal(inspirationStorageKey("biz_1"), "lge_inspiration:biz_1");
    assert.notEqual(inspirationStorageKey("biz_1"), inspirationStorageKey("biz_2"));
  });

  it("reads back what was stored, with the competitor's label", () => {
    const [item] = parseSavedInspiration(JSON.stringify([saved]));
    assert.equal(item.key, "c1:p1");
    assert.equal(item.name, "Brew Lane");
    assert.equal(item.post.caption, "New ✨");
  });

  it("drops malformed items and treats anything unreadable as an empty list", () => {
    assert.deepEqual(parseSavedInspiration(null), []);
    assert.deepEqual(parseSavedInspiration("not json"), []);
    assert.deepEqual(parseSavedInspiration(JSON.stringify({ key: "x" })), []);
    assert.deepEqual(parseSavedInspiration(JSON.stringify([{ key: "x" }, null, { ...saved, post: { id: "p2" } }, saved])), [saved]);
  });

  it(`keeps at most ${MAX_SAVED_INSPIRATION}`, () => {
    const many = Array.from({ length: MAX_SAVED_INSPIRATION + 5 }, (_, i) => ({ ...saved, key: `c1:p${i}` }));
    assert.equal(parseSavedInspiration(JSON.stringify(many)).length, MAX_SAVED_INSPIRATION);
  });
});
