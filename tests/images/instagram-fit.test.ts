import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { IG_MAX_RATIO, IG_MAX_WIDTH, IG_MIN_RATIO, cropForInstagram, toInstagramJpeg } from "../../lib/services/images/instagram-fit";

const png = (width: number, height: number, alpha = false) =>
  sharp({ create: { width, height, channels: alpha ? 4 : 3, background: alpha ? { r: 200, g: 50, b: 50, alpha: 0.5 } : { r: 200, g: 50, b: 50 } } }).png().toBuffer();

describe("cropForInstagram", () => {
  it("leaves allowed shapes alone", () => {
    assert.equal(cropForInstagram(1024, 1024), null);
    assert.equal(cropForInstagram(1080, 1350), null); // 4:5
    assert.equal(cropForInstagram(1910, 1000), null); // 1.91:1
  });

  it("centre-crops tall images to 4:5", () => {
    const box = cropForInstagram(1080, 1920)!;
    assert.deepEqual(box, { left: 0, top: 285, width: 1080, height: 1350 });
    assert.ok(Math.abs(box.width / box.height - IG_MIN_RATIO) < 0.01);
  });

  it("centre-crops wide images to 1.91:1", () => {
    const box = cropForInstagram(3000, 1000)!;
    assert.deepEqual(box, { left: 545, top: 0, width: 1910, height: 1000 });
    assert.ok(Math.abs(box.width / box.height - IG_MAX_RATIO) < 0.01);
  });
});

describe("toInstagramJpeg", () => {
  it("converts PNG (with transparency) to a JPEG", async () => {
    const out = await toInstagramJpeg(await png(800, 800, true));
    const meta = await sharp(out.data).metadata();
    assert.equal(meta.format, "jpeg");
    assert.equal(meta.hasAlpha, false);
    assert.deepEqual([out.width, out.height, out.cropped], [800, 800, false]);
  });

  it("crops a phone screenshot and limits the width to 1440 px", async () => {
    const out = await toInstagramJpeg(await png(2160, 3840));
    assert.equal(out.cropped, true);
    assert.equal(out.width, IG_MAX_WIDTH);
    assert.ok(Math.abs(out.width / out.height - IG_MIN_RATIO) < 0.01);
  });

  it("rejects bytes that aren't an image", async () => {
    await assert.rejects(toInstagramJpeg(Buffer.from("not an image")));
  });
});
