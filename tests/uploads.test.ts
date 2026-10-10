import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkImageFile, POST_IMAGE_MAX_BYTES, sniffImage, sniffVideo } from "../lib/uploads/sniff";

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string, pad = 0) => new Uint8Array([...Buffer.from(text, "ascii"), ...new Array(pad).fill(0)]);

describe("sniffImage (server check by content)", () => {
  it("recognises JPG, PNG and WebP from their first bytes", () => {
    assert.equal(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0)), "jpg");
    assert.equal(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0)), "png");
    assert.equal(sniffImage(ascii("RIFF\0\0\0\0WEBPVP8 ")), "webp");
  });

  it("rejects other files whatever their name or MIME type", () => {
    assert.equal(sniffImage(ascii("GIF89a", 10)), null);
    assert.equal(sniffImage(ascii("<svg xmlns='http://www.w3.org/2000/svg'/>")), null);
    assert.equal(sniffImage(ascii("%PDF-1.7", 10)), null);
    assert.equal(sniffImage(ascii("RIFF\0\0\0\0WAVEfmt ")), null);
    assert.equal(sniffImage(bytes()), null);
    assert.equal(sniffImage(bytes(0xff, 0xd8)), null);
  });

  it("only accepts MP4 as video", () => {
    assert.equal(sniffVideo(ascii("\0\0\0\x18ftypisom", 8)), "mp4");
    assert.equal(sniffVideo(ascii("\0\0\0\x18ftypqt  ", 8)), null);
  });
});

describe("checkImageFile (browser check before upload)", () => {
  const ok = { name: "photo.jpg", type: "image/jpeg", size: 1024 };

  it("accepts JPG, PNG and WebP up to 8 MB", () => {
    assert.equal(checkImageFile(ok), null);
    assert.equal(checkImageFile({ ...ok, name: "a.png", type: "image/png" }), null);
    assert.equal(checkImageFile({ ...ok, name: "a.webp", type: "image/webp" }), null);
    assert.equal(checkImageFile({ ...ok, size: POST_IMAGE_MAX_BYTES }), null);
  });

  it("rejects other types", () => {
    assert.equal(checkImageFile({ ...ok, name: "a.gif", type: "image/gif" }), "type");
    assert.equal(checkImageFile({ ...ok, name: "a.heic", type: "image/heic" }), "type");
    assert.equal(checkImageFile({ ...ok, name: "a.svg", type: "image/svg+xml" }), "type");
    assert.equal(checkImageFile({ ...ok, name: "clip.mp4", type: "video/mp4" }), "type");
  });

  it("falls back to the extension when the browser gives no type", () => {
    assert.equal(checkImageFile({ name: "IMG_1.JPEG", type: "", size: 10 }), null);
    assert.equal(checkImageFile({ name: "notes.txt", type: "", size: 10 }), "type");
  });

  it("rejects empty and oversized files", () => {
    assert.equal(checkImageFile({ ...ok, size: 0 }), "empty");
    assert.equal(checkImageFile({ ...ok, size: POST_IMAGE_MAX_BYTES + 1 }), "size");
    assert.equal(checkImageFile({ ...ok, size: 30 * 1024 * 1024 }, 2 * 1024 * 1024), "size");
  });
});
