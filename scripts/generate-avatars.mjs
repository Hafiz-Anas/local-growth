/**
 * Generates the placeholder profile pictures in /public/avatars.
 * Businesses and competitors get original brand-style logo marks; people get
 * abstract silhouettes (never photos of real people). Run: `node scripts/generate-avatars.mjs`
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "avatars");

function write(path, body) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">${body}</svg>\n`,
  );
}

const SANS = "font-family='Inter, Helvetica, Arial, sans-serif'";
const SERIF = "font-family='Georgia, Times New Roman, serif'";

// --- Businesses (our clients) ------------------------------------------------

write(
  "businesses/mathanet-baity.svg",
  `<defs><radialGradient id="g" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="#7a4a2c"/><stop offset="1" stop-color="#3a2214"/></radialGradient></defs>
  <rect width="256" height="256" fill="url(#g)"/>
  <circle cx="128" cy="128" r="94" fill="none" stroke="#e9c891" stroke-width="5" stroke-dasharray="2 9" stroke-linecap="round"/>
  <g transform="rotate(-28 128 120)">
    <ellipse cx="128" cy="120" rx="38" ry="54" fill="#e9c891"/>
    <path d="M128 68c-18 30 18 54 0 104" fill="none" stroke="#3a2214" stroke-width="8" stroke-linecap="round"/>
  </g>
  <text x="128" y="206" text-anchor="middle" ${SANS} font-size="22" font-weight="800" letter-spacing="5" fill="#e9c891">BAITY</text>`,
);

write(
  "businesses/dalla-bean.svg",
  `<rect width="256" height="256" fill="#f3e6d8"/>
  <circle cx="128" cy="128" r="100" fill="#ead6c1"/>
  <g fill="#7a4a2a">
    <circle cx="128" cy="58" r="8"/>
    <path d="M106 92q22-30 44 0z"/>
    <rect x="112" y="92" width="32" height="14" rx="3"/>
    <path d="M100 108h56l14 66q3 16-13 16H99q-16 0-13-16z"/>
    <path d="M102 122C74 112 62 92 48 78l10-7c13 14 26 32 46 40z"/>
    <path d="M156 114c30 4 34 48 8 64l-5-8c16-12 14-40-6-45z"/>
  </g>
  <circle cx="128" cy="150" r="10" fill="#f3e6d8"/>`,
);

write(
  "businesses/noor-boutique.svg",
  `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbe3ea"/><stop offset="1" stop-color="#e8a1b8"/></linearGradient></defs>
  <rect width="256" height="256" fill="url(#g)"/>
  <path d="M150 52a26 26 0 1 0 20 42 30 30 0 1 1-20-42z" fill="#7a1f45"/>
  <text x="128" y="190" text-anchor="middle" ${SERIF} font-size="120" font-style="italic" fill="#7a1f45">N</text>
  <path d="M84 206h88" stroke="#7a1f45" stroke-width="3" stroke-linecap="round"/>`,
);

write(
  "team/raid-admin.svg",
  `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f2937"/><stop offset="1" stop-color="#0b1220"/></linearGradient>
  <linearGradient id="a" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#f58529"/><stop offset=".45" stop-color="#dd2a7b"/><stop offset="1" stop-color="#515bd4"/></linearGradient></defs>
  <rect width="256" height="256" fill="url(#g)"/>
  <path d="M128 44l72 42v84l-72 42-72-42V86z" fill="none" stroke="url(#a)" stroke-width="10" stroke-linejoin="round"/>
  <text x="128" y="160" text-anchor="middle" ${SANS} font-size="96" font-weight="800" fill="#ffffff">R</text>`,
);

// --- Competitors (fictional local brands) -------------------------------------

const competitors = [
  ["alyasmin-roastery", "#2f4a2a", "#e8f1d0", "AY", SANS, "star"],
  ["hamsa-nuts", "#f0dcc0", "#7b4a1e", "H", SERIF, "ring"],
  ["bayt-alhalwa", "#f6c1cf", "#8a1c43", "BH", SANS, "arch"],
  ["qahwat-aldeerah", "#151515", "#d4a373", "QD", SANS, "ring"],
  ["brewlab-q8", "#1e293b", "#7dd3fc", "BL", SANS, "bar"],
  ["rawda-coffee", "#dfe9c8", "#3f6212", "R", SERIF, "arch"],
  ["lamar-abayas", "#0b0b0b", "#e5e5e5", "L", SERIF, "bar"],
];

const accents = {
  star: (c) => `<path d="M128 40l6 14 15 1-12 9 4 15-13-8-13 8 4-15-12-9 15-1z" fill="${c}"/>`,
  ring: (c) => `<circle cx="128" cy="128" r="96" fill="none" stroke="${c}" stroke-width="4"/>`,
  arch: (c) => `<path d="M64 200V120a64 64 0 0 1 128 0v80" fill="none" stroke="${c}" stroke-width="5" opacity=".6"/>`,
  bar: (c) => `<rect x="96" y="184" width="64" height="6" rx="3" fill="${c}"/>`,
};

for (const [name, bg, fg, letters, font, accent] of competitors) {
  const size = letters.length > 1 ? 84 : 116;
  write(
    `competitors/${name}.svg`,
    `<rect width="256" height="256" fill="${bg}"/>${accents[accent](fg)}
    <text x="128" y="${128 + size * 0.35}" text-anchor="middle" ${font} font-size="${size}" font-weight="700" fill="${fg}">${letters}</text>`,
  );
}

// --- People (commenters): abstract silhouettes --------------------------------

const people = [
  ["fajer-q8", "#f9d6dc", "#c2185b"],
  ["abdullah-alenezi", "#d7e3f4", "#1e3a5f"],
  ["m-alsabah", "#eadfce", "#7b5b3a"],
  ["sara-bakes-kw", "#dcefd3", "#4d7c0f"],
  ["hessa-kw", "#ead7f2", "#6c3483"],
  ["noura-sips", "#fde2cf", "#c2410c"],
  ["bader-kw", "#d9e2ec", "#334155"],
  ["lulu-alali", "#d5f0ec", "#0f766e"],
  ["maryam-styles", "#fbd5e5", "#9d174d"],
  ["dana-kw", "#efe3cf", "#92400e"],
];

for (const [name, bg, fg] of people) {
  write(
    `people/${name}.svg`,
    `<rect width="256" height="256" fill="${bg}"/>
    <circle cx="128" cy="104" r="44" fill="${fg}" opacity=".85"/>
    <path d="M44 256c0-50 38-86 84-86s84 36 84 86z" fill="${fg}" opacity=".85"/>`,
  );
}

console.log("Avatars written to", root);
