import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_SAVED_CHATS, chatGroup, chatsStorageKey, groupChats, parseSavedChats, shiftChats } from "../lib/gallery/saved-chats";
import type { AiChat } from "../mock-data/gallery/ai-studio";

const chat = (id: string, at: string, extra?: Partial<AiChat>): AiChat => ({
  id,
  title: { en: "What should I post tomorrow?", ar: "ماذا أنشر غداً؟" },
  at,
  messages: [{ id: `${id}u`, role: "user", text: { en: "Hi", ar: "Hi" } }],
  ...extra,
});

describe("AI chats saved in the browser", () => {
  it("are kept per business", () => {
    assert.equal(chatsStorageKey("biz_1"), "lge_ai_chats:biz_1");
    assert.notEqual(chatsStorageKey("biz_1"), chatsStorageKey("biz_2"));
  });

  it("read back what was stored", () => {
    const [c] = parseSavedChats(JSON.stringify([chat("c1", "2026-10-29T09:00:00.000Z")]));
    assert.equal(c.id, "c1");
    assert.equal(c.messages.length, 1);
  });

  it("drop the mode older chats were saved with (chats have no modes now)", () => {
    const [c] = parseSavedChats(JSON.stringify([{ ...chat("old", "2026-10-29T09:00:00.000Z"), mode: "analytics" }]));
    assert.equal(c.id, "old");
    assert.equal("mode" in c, false);
  });

  it("show answers that were still working when the page closed as finished", () => {
    const working = chat("c1", "2026-10-29T09:00:00.000Z", {
      messages: [{ id: "a", role: "ai", kind: "directions", steps: [{ key: "look" }], ready: false, options: [] }],
    });
    const [c] = parseSavedChats(JSON.stringify([working]));
    assert.equal("ready" in c.messages[0] && c.messages[0].ready, true);
  });

  it("drop malformed chats and messages; anything unreadable is an empty list", () => {
    assert.deepEqual(parseSavedChats(null), []);
    assert.deepEqual(parseSavedChats("not json"), []);
    assert.deepEqual(parseSavedChats("{}"), []);
    const raw = JSON.stringify([
      chat("ok", "2026-10-29T09:00:00.000Z", { messages: [{ id: "u", role: "user", text: { en: "x", ar: "x" } }, { id: 3 } as never, { id: "z", role: "bot" } as never] }),
      { ...chat("bad-date", "yesterday") },
      { id: "no-title", at: "2026-10-29T09:00:00.000Z", messages: [] },
      null,
    ]);
    const list = parseSavedChats(raw);
    assert.deepEqual(
      list.map((c) => c.id),
      ["ok"],
    );
    assert.equal(list[0].messages.length, 1);
  });

  it(`keep at most ${MAX_SAVED_CHATS}`, () => {
    const many = Array.from({ length: MAX_SAVED_CHATS + 5 }, (_, i) => chat(`c${i}`, "2026-10-29T09:00:00.000Z"));
    assert.equal(parseSavedChats(JSON.stringify(many)).length, MAX_SAVED_CHATS);
  });
});

describe("Chat list groups", () => {
  const now = new Date(2026, 9, 29, 10, 0);
  const at = (d: number, h: number) => new Date(2026, 9, d, h, 0).toISOString();

  it("are Today, Yesterday and Earlier by calendar day", () => {
    assert.equal(chatGroup(at(29, 0), now), "today");
    assert.equal(chatGroup(at(28, 23), now), "yesterday");
    assert.equal(chatGroup(at(28, 0), now), "yesterday");
    assert.equal(chatGroup(at(27, 23), now), "earlier");
    assert.equal(chatGroup(at(1, 12), now), "earlier");
  });

  it("list newest first and leave out empty groups", () => {
    const groups = groupChats([chat("old", at(20, 9)), chat("today-1", at(29, 8)), chat("today-2", at(29, 9))], now);
    assert.deepEqual(
      groups.map((g) => [g.group, g.chats.map((c) => c.id)]),
      [
        ["today", ["today-2", "today-1"]],
        ["earlier", ["old"]],
      ],
    );
  });

  it("move the sample chats to sit as far before now as before the demo clock", () => {
    const demoNow = new Date("2026-10-16T16:30:00.000Z");
    const [c] = shiftChats([chat("s", "2026-10-15T14:30:00.000Z")], demoNow, new Date("2026-10-29T16:30:00.000Z"));
    assert.equal(c.at, "2026-10-28T14:30:00.000Z");
  });
});
