import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { captionLanguage, inferPostingLanguages } from "../lib/brand-language";

describe("captionLanguage", () => {
  it("reads the script of the caption, ignoring hashtags, mentions and links", () => {
    assert.equal(captionLanguage("قهوة مختصة محمصة طازجة كل يوم ☕️ #coffee #kuwait @specialty.roasters"), "ar");
    assert.equal(captionLanguage("Fresh specialty coffee, roasted daily ☕️ #قهوة"), "en");
    assert.equal(captionLanguage("Fresh maamoul today — معمول طازج اليوم"), "both");
    assert.equal(captionLanguage("Visit https://example.com/menu"), "en");
  });

  it("returns null when there is too little text", () => {
    assert.equal(captionLanguage(""), null);
    assert.equal(captionLanguage("☕️🔥 #coffee"), null);
  });
});

describe("inferPostingLanguages", () => {
  it("keeps each language used in at least a quarter of the captions", () => {
    assert.deepEqual(inferPostingLanguages(["قهوة اليوم", "عرض خاص لنهاية الأسبوع", "جديدنا وصل", "حياكم في الفرع", "كيكة الزعفران"]), ["ar"]);
    assert.deepEqual(inferPostingLanguages(["New in today", "Weekend offer", "Come say hi", "Saffron cake is back"]), ["en"]);
    assert.deepEqual(inferPostingLanguages(["قهوة اليوم", "New in today", "عرض خاص", "حياكم"]), ["ar", "en"]);
    assert.deepEqual(inferPostingLanguages(["Fresh maamoul — معمول طازج", "قهوة اليوم", "جديدنا", "حياكم"]), ["ar", "en"]);
  });

  it("ignores a single stray caption in the other language", () => {
    assert.deepEqual(inferPostingLanguages(["قهوة اليوم", "عرض خاص", "جديدنا وصل", "حياكم في الفرع", "Happy Eid"]), ["ar"]);
  });

  it("returns null when nothing can be read", () => {
    assert.equal(inferPostingLanguages([]), null);
    assert.equal(inferPostingLanguages(["", "🔥🔥", "#coffee"]), null);
  });
});
