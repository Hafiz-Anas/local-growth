import { accounts, cameraRollFiles } from "./accounts";
import { captionFor, categoriesFor, categoryAlbumId, dishes, hashtagsFor, withTags } from "./categories";
import { NOW, ago, kuwaitAt } from "./clock";
import { photoSources } from "./photo-sources";
import type { AccountId, Photo, PhotoSource, PhotoStatus, PostType } from "./types";

/** Small deterministic PRNG so the mock numbers are identical on every load. */
export function seeded(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Library position (0 = newest) -> status. About half the library is plain photos (4 AI images + fresh uploads,
// spread over every category album) and half ready posts (3 scheduled, 3 drafts, the rest published on Instagram).
const DRAFTS = [3, 9, 19];
const SCHEDULED = [1, 5, 12];
const AI = [6, 14, 23, 30];
const FAVORITES = [7, 13, 17, 21, 26, 33];
// Promoted posts, by their rank among the published ones (0 = newest).
const PROMOTED = [2, 6, 10];
// Upcoming slots for scheduled posts (days from today, Kuwait hour).
const SCHEDULE_SLOTS: [number, number, number][] = [
  [1, 20, 30],
  [2, 13, 0],
  [4, 20, 0],
];

const SEEDS: Record<AccountId, number> = { mathanet: 11, qahwa: 23, tannour: 37 };

function buildPhotos(accountId: AccountId): Photo[] {
  const account = accounts.find((a) => a.id === accountId)!;
  const rand = seeded(SEEDS[accountId]);
  const roll = new Set(cameraRollFiles[accountId]);
  const sources = photoSources[accountId];
  const files = sources.map((_, i) => i + 1).filter((n) => !roll.has(n));
  // Shuffle a little so similar shots don't sit side by side.
  const order = files
    .map((n) => ({ n, k: rand() }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.n);
  const uploads = plainUploads(accountId, order);

  let day = 0;
  let publishedRank = 0;
  return order.map((n, i) => {
    const src = sources[n - 1];
    const file = String(n).padStart(2, "0");
    if (i > 0) day += rand() < 0.35 ? 0 : 1 + Math.floor(rand() * 2);
    const takenAt = ago(day, i === 0 ? 2 : 3 + Math.floor(rand() * 9), Math.floor(rand() * 59));

    let status: PhotoStatus = "published";
    let source: PhotoSource = "instagram";
    if (uploads.has(i)) [status, source] = ["none", "upload"];
    if (DRAFTS.includes(i)) [status, source] = ["draft", "upload"];
    if (SCHEDULED.includes(i)) [status, source] = ["scheduled", "upload"];
    if (AI.includes(i)) [status, source] = ["none", "ai"];

    const { c, ...dish } = dishes[accountId][n - 1];
    const photo: Photo = {
      id: `${accountId}-${file}`,
      accountId,
      src: `/photos/${accountId}/${file}.jpg`,
      thumb: `/photos/${accountId}/${file}-t.jpg`,
      dish,
      category: c,
      takenAt,
      status,
      source,
      favorite: FAVORITES.includes(i),
      albums: [categoryAlbumId(c)],
      credit: { author: src.author, link: src.link },
    };
    if (source === "ai") photo.look = (AI.indexOf(i) % 3) + 1;

    if (status === "scheduled") {
      const [d, h, m] = SCHEDULE_SLOTS[SCHEDULED.indexOf(i)];
      photo.scheduledFor = kuwaitAt(d, h, m);
      photo.caption = fill(account, photo, "base");
    }
    if (status === "draft") photo.caption = fill(account, photo, "friendly");

    if (status === "published") {
      const postType: PostType = rand() < 0.3 ? "reel" : rand() < 0.5 ? "carousel" : "photo";
      const promoted = PROMOTED.includes(publishedRank++);
      const typeBoost = postType === "reel" ? 1.6 : postType === "carousel" ? 1.15 : 0.85;
      const reach = Math.round(account.followers * (0.28 + rand() * 0.55) * typeBoost * (promoted ? 2.1 : 1));
      const engageBoost = postType === "reel" ? 1.3 : postType === "carousel" ? 1.12 : 0.85;
      const likes = Math.round(reach * (0.045 + rand() * 0.04) * engageBoost);
      const comments = Math.max(3, Math.round(likes * (0.03 + rand() * 0.05)));
      const saves = Math.round(likes * (0.08 + rand() * 0.18));
      const shares = Math.round(likes * (0.03 + rand() * 0.08));
      const decay = [0.42, 0.22, 0.12, 0.09, 0.07, 0.05, 0.03];
      photo.publishedAt = new Date(Math.min(new Date(takenAt).getTime() + 5 * 3_600_000, NOW.getTime() - 3_600_000)).toISOString();
      photo.postType = postType;
      photo.promoted = promoted;
      photo.metrics = { likes, comments, reach, saves, shares, reachByDay: decay.map((d) => Math.round(reach * d)) };
      photo.caption = fill(account, photo, "base");
    }
    return photo;
  });
}

/**
 * Library positions of the plain uploads: enough to make about half the library plain photos, taken newest first
 * from each category album in turn, so every category has a few photos to try "Create post with AI" with.
 */
function plainUploads(accountId: AccountId, order: number[]) {
  const target = Math.floor(order.length / 2) - AI.length;
  const free = (i: number) => !DRAFTS.includes(i) && !SCHEDULED.includes(i) && !AI.includes(i);
  const queues = categoriesFor(accountId).map((c) => order.flatMap((n, i) => (free(i) && dishes[accountId][n - 1].c === c.id ? [i] : [])));
  const picked = new Set<number>();
  while (picked.size < target && queues.some((q) => q.length))
    for (const q of queues) if (q.length && picked.size < target) picked.add(q.shift()!);
  return picked;
}

/** A seeded post's caption: the category's template for the dish, plus its hashtags. */
const fill = (account: (typeof accounts)[number], photo: Photo, tone: "base" | "friendly") =>
  withTags(captionFor(account, photo, tone), hashtagsFor(account, photo.category));

/** The mock "camera roll" shown in the upload picker. */
export function cameraRoll(accountId: AccountId) {
  return cameraRollFiles[accountId].map((n) => {
    const file = String(n).padStart(2, "0");
    const { c, ...dish } = dishes[accountId][n - 1];
    return {
      file,
      src: `/photos/${accountId}/${file}.jpg`,
      thumb: `/photos/${accountId}/${file}-t.jpg`,
      dish,
      category: c,
      credit: { author: photoSources[accountId][n - 1].author, link: photoSources[accountId][n - 1].link },
    };
  });
}

export const initialPhotos: Record<AccountId, Photo[]> = {
  mathanet: buildPhotos("mathanet"),
  qahwa: buildPhotos("qahwa"),
  tannour: buildPhotos("tannour"),
};
