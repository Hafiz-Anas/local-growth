import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { captionIsGrounded, nameTag, neutralCaption, parsePhotoCaption } from "../../lib/services/text/photo-caption";
import { photoCaptionData, photoCaptionPrompt } from "../../lib/services/text/prompts";

const input = {
  businessName: "Fereej Bakery",
  businessNameAr: "مخبز الفريج",
  focus: null,
  title: "zaatar manakish",
  request: "for the weekend, 2 boxes",
};
const data = photoCaptionData(input);
const answer = (fields: Record<string, unknown>) => JSON.stringify({ caption_en: "Warm zaatar manakish, fresh from the oven.", caption_ar: "مناقيش زعتر طازجة من الفرن.", hashtags: ["#manakish", "zaatar"], ...fields });

describe("Photo captions (AI chat post card)", () => {
  it("reads a good answer: both captions, hashtags normalised, none inside the text", () => {
    const parsed = parsePhotoCaption(answer({ caption_en: "Warm zaatar manakish #yum, fresh from the oven." }), data);
    assert.equal(parsed.caption.en, "Warm zaatar manakish, fresh from the oven.", "the inline hashtag moves to the hashtags");
    assert.deepEqual(parsed.hashtags, ["#manakish", "#zaatar", "#yum"]);
  });

  it("rejects numbers that aren't in the business data or the owner's request", () => {
    assert.throws(() => parsePhotoCaption(answer({ caption_en: "Only 3.5 KD today!" }), data), /number or claim/);
    assert.throws(() => parsePhotoCaption(answer({ caption_ar: "خصم ٢٠٪ اليوم" }), data), /number or claim/);
    // "2 boxes" came from the owner's request.
    assert.doesNotThrow(() => parsePhotoCaption(answer({ caption_en: "Order 2 boxes for the weekend." }), data));
  });

  it("rejects invented performance claims, in English and Arabic", () => {
    for (const claim of ["Our best-selling manakish.", "Everyone's favourite breakfast!", "The most loved bakery in Salmiya.", "Sold out every morning."]) {
      assert.equal(captionIsGrounded(claim, data), false, claim);
    }
    assert.equal(captionIsGrounded("المناقيش الأكثر مبيعاً عندنا", data), false);
    assert.equal(captionIsGrounded("الأفضل في الكويت", data), false);
    assert.equal(captionIsGrounded("Fresh from the oven this morning.", data), true);
  });

  it("rejects empty, missing or hashtag-less answers", () => {
    assert.throws(() => parsePhotoCaption("not json", data));
    assert.throws(() => parsePhotoCaption(answer({ caption_ar: "" }), data), /no caption/);
    assert.throws(() => parsePhotoCaption(answer({ hashtags: [] }), data), /no hashtags/);
  });

  it("sends the photos as images and fences the owner's request as data", () => {
    const prompt = photoCaptionPrompt({ ...input, images: [{ mimeType: "image/jpeg", data: "AAAA" }], tone: "shorter" });
    assert.equal(prompt.images?.length, 1);
    assert.match(prompt.system, /<request>\nfor the weekend, 2 boxes\n<\/request>/);
    assert.match(prompt.system, /under 20 words/);
    assert.match(prompt.system, /مخبز الفريج/);
    const blind = photoCaptionPrompt({ ...input, images: [], tone: "base" });
    assert.match(blind.system, /couldn't be loaded/);
  });
});

describe("Neutral caption (AI unavailable)", () => {
  const base = { businessName: "Fereej Bakery", businessNameAr: "مخبز الفريج", defaultHashtags: ["kuwaitfood", "#Bakery"], area: "Salmiya", areaAr: "السالمية" };

  it("is about the business only: its names, area and own hashtags, no numbers or claims", () => {
    const { caption, hashtags } = neutralCaption(base);
    assert.match(caption.en, /Fereej Bakery/);
    assert.match(caption.en, /Salmiya/);
    assert.match(caption.ar, /مخبز الفريج/);
    assert.match(caption.ar, /السالمية/);
    assert.deepEqual(hashtags, ["#kuwaitfood", "#Bakery", "#FereejBakery"]);
    assert.equal(captionIsGrounded(caption.en, "") && captionIsGrounded(caption.ar, ""), true);
  });

  it("follows the tone and works without an Arabic name or area", () => {
    const short = neutralCaption({ ...base, businessNameAr: null, area: null, areaAr: null }, "shorter");
    assert.ok(short.caption.en.split(" ").length < 12);
    assert.match(short.caption.ar, /Fereej Bakery/);
    assert.doesNotMatch(short.caption.en, /visit/i);
  });

  it("makes a hashtag from the name", () => {
    assert.equal(nameTag("Dalla & Bean"), "#DallaBean");
    assert.equal(nameTag("مخبز الفريج"), "#مخبزالفريج");
    assert.equal(nameTag("&"), "");
  });
});
