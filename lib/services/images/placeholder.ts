import { deflateSync } from "node:zlib";

/**
 * The mock image provider's output: a real PNG (diagonal gradient in the brand
 * colours with soft circles) so the whole flow — storage, preview, queueing —
 * works without calling any API. Pure Node, no image libraries.
 */

const FALLBACK = ["#c08552", "#6b3e26"];

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(/^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "c08552", 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A size×size PNG; `variant` moves the circles so "Regenerate" visibly changes the image. */
export function placeholderPng(colors: string[], variant = 0, size = 512): Buffer {
  const palette = (colors.length >= 2 ? colors : colors.length === 1 ? [colors[0], FALLBACK[1]] : FALLBACK).map(rgb);
  const [from, to] = [palette[0], palette[1]];
  const accent = palette[2] ?? [255, 255, 255];
  const circles = [0, 1, 2].map((i) => {
    const seed = (variant * 7 + i * 13) % 17;
    return { x: size * (0.2 + ((seed * 37) % 60) / 100), y: size * (0.2 + ((seed * 53) % 60) / 100), r: size * (0.12 + (seed % 5) * 0.03) };
  });

  const rows: Buffer[] = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3); // filter byte 0 + RGB
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * (size - 1));
      let px = [0, 1, 2].map((c) => from[c] + (to[c] - from[c]) * t);
      for (const circle of circles) {
        if ((x - circle.x) ** 2 + (y - circle.y) ** 2 < circle.r ** 2) px = px.map((v, c) => v * 0.72 + accent[c] * 0.28);
      }
      row[1 + x * 3] = Math.round(px[0]);
      row[2 + x * 3] = Math.round(px[1]);
      row[3 + x * 3] = Math.round(px[2]);
    }
    rows.push(row);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
