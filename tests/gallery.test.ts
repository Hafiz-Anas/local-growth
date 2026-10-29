import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashtagsIn, mergeVersions, parseVersions, primaryCaption, withHashtags, withVersion } from "../lib/gallery/drafts";
import { apiId, hydrateGallery, screenId } from "../lib/gallery/hydrate";
import { igPhotoId, parsePhotoRef, sampleKeyFromSrc, samplePhotoId, splitSampleKey } from "../lib/gallery/refs";
import { suggestPostTime, zonedTime } from "../lib/gallery/suggest-time";
import {
  GALLERY_CAPTION_VERSIONS,
  GALLERY_MAX_EDGE,
  GALLERY_PICK_MAX_BYTES,
  checkPickedPhoto,
  extensionFor,
  fitWithin,
  isUploadType,
  keepsOriginal,
  mapLimited,
  titleFromName,
} from "../lib/gallery/uploads";

describe("Gallery photo ids", () => {
  it("tells own photos, Instagram posts and sample photos apart", () => {
    assert.deepEqual(parsePhotoRef("clx1a2b3c4d5e6f7g8h9i0jk"), { kind: "own", id: "clx1a2b3c4d5e6f7g8h9i0jk" });
    assert.deepEqual(parsePhotoRef(igPhotoId("17890012345")), { kind: "instagram", igMediaId: "17890012345" });
    assert.deepEqual(parsePhotoRef(samplePhotoId("mathanet-07")), { kind: "sample", key: "mathanet-07" });
    assert.deepEqual(parsePhotoRef("sample:qahwa-12~3"), { kind: "sample", key: "qahwa-12~3" });
  });

  it("rejects anything else, so made-up ids never reach the database", () => {
    for (const bad of ["", "upload-abc", "sample:../../etc", "sample:mathanet-7", "sample:mathanet-07~9", "ig:", "ig:a b", "CLX1A2B3C4D5E6F7G8H9I0JK", "c123"]) {
      assert.equal(parsePhotoRef(bad), null, bad);
    }
  });

  it("maps sample image paths to their keys, with the AI look", () => {
    assert.equal(sampleKeyFromSrc("/photos/mathanet/07.jpg"), "mathanet-07");
    assert.equal(sampleKeyFromSrc("/photos/tannour/21.jpg", 2), "tannour-21~2");
    assert.equal(sampleKeyFromSrc("/photos/mathanet/07-t.jpg"), null);
    assert.equal(sampleKeyFromSrc("https://example.com/photos/mathanet/07.jpg"), null);
    assert.deepEqual(splitSampleKey("tannour-21~2"), { photoId: "tannour-21", look: 2 });
    assert.deepEqual(splitSampleKey("tannour-21"), { photoId: "tannour-21" });
  });
});

describe("Gallery upload rules", () => {
  it("accepts JPG, PNG, WebP and iPhone HEIC; refuses other files, empty ones and huge ones", () => {
    assert.equal(checkPickedPhoto({ name: "a.jpg", type: "image/jpeg", size: 3_000_000 }), null);
    assert.equal(checkPickedPhoto({ name: "IMG_0001.HEIC", type: "image/heic", size: 2_000_000 }), null);
    // Some phones give no type: the extension decides.
    assert.equal(checkPickedPhoto({ name: "photo.webp", type: "", size: 10 }), null);
    assert.equal(checkPickedPhoto({ name: "clip.mp4", type: "video/mp4", size: 10 }), "type");
    assert.equal(checkPickedPhoto({ name: "doc.pdf", type: "", size: 10 }), "type");
    assert.equal(checkPickedPhoto({ name: "a.jpg", type: "image/jpeg", size: 0 }), "empty");
    assert.equal(checkPickedPhoto({ name: "a.jpg", type: "image/jpeg", size: GALLERY_PICK_MAX_BYTES + 1 }), "size");
  });

  it("only uploads JPG, PNG and WebP, with their extensions", () => {
    assert.equal(isUploadType("image/jpeg"), true);
    assert.equal(isUploadType("image/heic"), false);
    assert.equal(extensionFor("image/jpeg"), "jpg");
    assert.equal(extensionFor("image/webp"), "webp");
  });

  it("resizes to fit the long side, never enlarging", () => {
    assert.deepEqual(fitWithin(4032, 3024), { width: GALLERY_MAX_EDGE, height: 1536 });
    assert.deepEqual(fitWithin(3024, 4032), { width: 1536, height: GALLERY_MAX_EDGE });
    assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
  });

  it("keeps a small JPEG as it is and redraws everything else", () => {
    assert.equal(keepsOriginal({ type: "image/jpeg", size: 900_000 }, 1600, 1200), true);
    assert.equal(keepsOriginal({ type: "image/jpeg", size: 4_000_000 }, 1600, 1200), false);
    assert.equal(keepsOriginal({ type: "image/jpeg", size: 900_000 }, 4000, 3000), false);
    assert.equal(keepsOriginal({ type: "image/png", size: 100_000 }, 600, 600), false);
  });

  it("takes a title from a meaningful file name only", () => {
    assert.equal(titleFromName("pistachio-kunafa.jpg"), "pistachio kunafa");
    assert.equal(titleFromName("كنافة_بالفستق.jpeg"), "كنافة بالفستق");
    for (const camera of ["IMG_1234.JPG", "DSC0001.jpg", "PXL_20261029_094103.jpg", "WhatsApp Image 2026-10-29 at 9.41.03.jpeg", "image.png", "20261029.jpg"]) {
      assert.equal(titleFromName(camera), "", camera);
    }
  });

  it("runs uploads a few at a time and keeps the order", async () => {
    let running = 0;
    let most = 0;
    const out = await mapLimited([5, 1, 4, 2, 3], 2, async (n) => {
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, n));
      running--;
      return n * 10;
    });
    assert.deepEqual(out, [50, 10, 40, 20, 30]);
    assert.equal(most, 2);
  });
});

describe("Gallery drafts", () => {
  const at = "2026-10-29T09:00:00.000Z";
  const a = { en: "First", ar: "الأول" };
  const b = { en: "Second", ar: "الثاني" };

  it("keeps the replaced caption as the newest version, without repeats or empties", () => {
    const one = withVersion([], a, b, at);
    assert.deepEqual(one, [{ ...a, at }]);
    assert.equal(withVersion(one, a, { en: "Third", ar: "الثالث" }, at), one, "the same caption again isn't kept twice");
    assert.deepEqual(withVersion([], { en: "", ar: " " }, b, at), []);
    assert.deepEqual(withVersion([], a, a, at), []);
  });

  it("keeps at most GALLERY_CAPTION_VERSIONS", () => {
    let versions = parseVersions([]);
    for (let i = 0; i < GALLERY_CAPTION_VERSIONS + 5; i++) versions = withVersion(versions, { en: `v${i}`, ar: `ن${i}` }, { en: "next", ar: "التالي" }, at);
    assert.equal(versions.length, GALLERY_CAPTION_VERSIONS);
    assert.equal(versions[0].en, `v${GALLERY_CAPTION_VERSIONS + 4}`);
  });

  it("reads stored versions safely and merges the chat's earlier ones", () => {
    assert.deepEqual(parseVersions(null), []);
    assert.deepEqual(parseVersions([{ en: "x" }, { en: "ok", ar: "تمام", at }, 5]), [{ en: "ok", ar: "تمام", at }]);
    assert.deepEqual(mergeVersions([{ ...a, at }], [{ ...a, at: "later" }, { ...b, at }]), [{ ...a, at }, { ...b, at }]);
  });

  it("fills the old single-language caption with Arabic when there is one", () => {
    assert.deepEqual(primaryCaption({ en: "Hi", ar: "هلا" }), { caption: "هلا", language: "ar" });
    assert.deepEqual(primaryCaption({ en: "Hi", ar: "" }), { caption: "Hi", language: "en" });
  });

  it("reads hashtags from a caption and adds missing ones once", () => {
    assert.deepEqual(hashtagsIn("Fresh #kunafa today #Kuwait", "#kunafa #حلويات"), ["#kunafa", "#Kuwait", "#حلويات"]);
    assert.equal(withHashtags("Fresh today #kunafa", ["#kunafa", "#kuwait"]), "Fresh today #kunafa\n\n#kuwait");
    assert.equal(withHashtags("Fresh today", []), "Fresh today");
  });
});

describe("Gallery on screen: real businesses never see sample photos (UX5)", () => {
  const own = {
    id: "clx1a2b3c4d5e6f7g8h9i0jk",
    source: "upload" as const,
    sample: false,
    url: "/api/uploads/gallery/a.jpg",
    thumbUrl: "/api/uploads/gallery-thumbs/a.webp",
    title: "pistachio kunafa",
    createdAt: "2026-10-29T09:00:00.000Z",
    favorite: true,
    albumIds: ["album1"],
    draftId: "draft1",
  };
  const draft = { id: "draft1", photoIds: [own.id], captionEn: "Fresh #kunafa", captionAr: "طازجة #كنافة", hashtags: ["#kunafa"], suggestedFor: null, versions: [], origin: "ai_chat" as const, updatedAt: own.createdAt };

  it("a real business gets only its own photos and albums, with drafts on them", () => {
    const { photos, albums } = hydrateGallery({ demo: false, photos: [own], albums: [{ id: "album1", name: "Sweets" }], drafts: [draft], hidden: [] }, "mathanet");
    assert.equal(photos.length, 1);
    assert.equal(photos[0].sample, undefined);
    assert.equal(photos[0].status, "draft");
    assert.deepEqual(photos[0].caption, { en: "Fresh #kunafa", ar: "طازجة #كنافة" });
    assert.equal(photos[0].draftId, "draft1");
    assert.deepEqual(albums, [{ id: "album1", name: { en: "Sweets", ar: "Sweets" } }]);
  });

  it("an empty real Gallery stays empty (the screen shows 'Upload your first photos')", () => {
    const { photos, albums } = hydrateGallery({ demo: false, photos: [], albums: [], drafts: [], hidden: [] }, "mathanet");
    assert.deepEqual(photos, []);
    assert.deepEqual(albums, []);
  });

  it("a demo business also gets the samples, each marked; hidden ones and the owner's changes are kept", () => {
    const state = { ...own, id: "sample:mathanet-07", sample: true, url: null, thumbUrl: null, title: null, favorite: true, albumIds: ["album1"], draftId: null };
    const { photos, albums } = hydrateGallery({ demo: true, photos: [own, state], albums: [{ id: "album1", name: "Mine" }], drafts: [draft], hidden: ["sample:mathanet-08"] }, "mathanet");
    const samples = photos.filter((p) => p.sample);
    assert.ok(samples.length > 10);
    assert.equal(photos.find((p) => p.id === "mathanet-08"), undefined, "hidden");
    const kept = photos.find((p) => p.id === "mathanet-07")!;
    assert.equal(kept.favorite, true);
    assert.ok(kept.albums.includes("album1"));
    assert.ok(albums.some((a) => a.category), "category albums are demo-only");
    assert.equal(apiId(kept), "sample:mathanet-07");
    assert.equal(screenId("sample:mathanet-07"), "mathanet-07");
    assert.equal(apiId(photos.find((p) => p.id === own.id)!), own.id);
  });
});

describe("Suggested posting time", () => {
  const kuwait = "Asia/Kuwait";

  it("places local times in the business's time zone", () => {
    assert.equal(zonedTime(2026, 10, 30, 19, 0, kuwait).toISOString(), "2026-10-30T16:00:00.000Z");
    assert.equal(zonedTime(2026, 10, 30, 19, 0, "UTC").toISOString(), "2026-10-30T19:00:00.000Z");
  });

  it("without a best slot: this evening if there's time, else tomorrow evening", () => {
    // 09:00 in Kuwait → 19:00 today.
    assert.equal(suggestPostTime(new Date("2026-10-29T06:00:00Z"), kuwait, null).toISOString(), "2026-10-29T16:00:00.000Z");
    // 18:00 in Kuwait → less than 2 hours left → tomorrow 19:00.
    assert.equal(suggestPostTime(new Date("2026-10-29T15:00:00Z"), kuwait, null).toISOString(), "2026-10-30T16:00:00.000Z");
  });

  it("uses the best weekday and part of the day", () => {
    // Thursday 29 Oct 2026 → next Saturday morning (10:00 Kuwait).
    assert.equal(suggestPostTime(new Date("2026-10-29T06:00:00Z"), kuwait, { weekday: "sat", dayPart: "morning" }).toISOString(), "2026-10-31T07:00:00.000Z");
    assert.equal(suggestPostTime(new Date("2026-10-29T06:00:00Z"), kuwait, { weekday: null, dayPart: "night" }).toISOString(), "2026-10-29T19:30:00.000Z");
  });
});
