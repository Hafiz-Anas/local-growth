/**
 * Generates the stand-in post images the MOCK InstagramService returns as media
 * URLs (public/mock-media/<tone>.svg): a soft two-colour gradient with abstract
 * shapes per tone — no photos. Brand-colour extraction reads these like real posts.
 *
 *   node scripts/generate-mock-media.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Same pairs as components/shared/media.tsx (content colours, not UI tokens).
const TONES = {
  roast: ["#c08552", "#6b3e26"],
  pistachio: ["#b5d99c", "#4d7c0f"],
  date: ["#e0b07a", "#7b3f00"],
  rose: ["#f8c8d4", "#c2185b"],
  latte: ["#ede0d4", "#9c6644"],
  sand: ["#f1e4d3", "#b08968"],
  night: ["#4b5563", "#111827"],
  berry: ["#e84393", "#6c3483"],
};

function svg(tone, [from, to]) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${from}"/>
      <stop offset="1" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <title>${tone}</title>
  <rect width="1080" height="1080" fill="url(#g)"/>
  <circle cx="540" cy="560" r="250" fill="#ffffff" fill-opacity="0.16"/>
  <circle cx="540" cy="560" r="160" fill="${to}" fill-opacity="0.55"/>
  <rect x="380" y="820" width="320" height="36" rx="18" fill="#ffffff" fill-opacity="0.35"/>
</svg>
`;
}

const out = path.resolve(import.meta.dirname, "..", "public", "mock-media");
await mkdir(out, { recursive: true });
for (const [tone, colors] of Object.entries(TONES)) {
  await writeFile(path.join(out, `${tone}.svg`), svg(tone, colors));
}
console.log(`Wrote ${Object.keys(TONES).length} images to ${out}`);
