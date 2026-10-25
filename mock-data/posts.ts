import type { CompetitorPost, MediaDto } from "@/types";

/**
 * Mock Instagram posts shared by the mock InstagramService and the seed (which back-fills
 * daily post snapshots). Stable for a given seed; timestamps are relative to `now`.
 * Captions carry the signals the analysis reads: hashtags, mentions (collaborations),
 * offers, giveaways and behind-the-scenes posts.
 */

export function hash(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

export const POST_TONES = ["roast", "sand", "latte", "rose", "pistachio", "date", "night", "berry"] as const;
export const POST_ICONS = ["coffee", "gift", "cake", "bag", "sparkles", "cup", "nut", "gem"] as const;

/** Stand-in post image per tone (public/mock-media, from scripts/generate-mock-media.mjs). */
export const mockMediaUrl = (tone: string) => `/mock-media/${tone}.svg`;

export const MOCK_CAPTIONS = [
  "New this week ✨ Come try it before it's gone! #kuwait #q8",
  "وصلت الدفعة الجديدة 🤍 اطلبوا الحين #الكويت",
  "Weekend special — 15% off everything until Saturday 🎉 #q8 #offer",
  "خلف الكواليس: هذا اللي نسويه كل صباح ☕",
  "Find us in the heart of the city 📍 Open daily 9am–11pm",
  "عرض خاص لنهاية الأسبوع 🔥 لا يفوتكم #عروض",
  "Our bestseller is back in stock 🙌 #kuwait",
  "Thank you for 10K followers 🤍 Giveaway: comment to win a gift box! #giveaway",
  "Fresh from the kitchen this morning with @chef.noura 👩‍🍳 #collab #q8",
  "تعرفوا على فريقنا 👋",
  "Gift boxes ready for the season 🎁 #kuwait #gifts",
  "Your favourites, delivered across Kuwait 🚚",
] as const;

const DAY = 24 * 60 * 60 * 1000;

/**
 * How often each MOCK_CAPTIONS post is sent to friends, in shares per 100 accounts reached, so the
 * Shareability findings have something real to find: giveaways, collaborations and gift posts get
 * shared most, "find us" and team posts least (typical rates for small local accounts: 0.5–3%).
 */
const CAPTION_SHARE_PCT = [1.0, 0.8, 1.6, 1.2, 0.4, 1.5, 0.9, 3.0, 2.4, 0.6, 2.0, 0.7] as const;
/** Reels travel further in DMs than photos. */
const FORMAT_SHARE_FACTOR: Record<NonNullable<MediaDto["format"]>, number> = { reel: 1.5, carousel: 1.2, photo: 1, video: 1.2 };

/** Shares for a mock post: its reach × its caption's share rate × its format's factor. */
export function mockShares(reach: number, format: NonNullable<MediaDto["format"]>, sharePct: number): number {
  return Math.round((reach * sharePct * FORMAT_SHARE_FACTOR[format]) / 100);
}

/** Every fourth post is a Reel; one in three of the others a carousel. */
export function mockFormat(i: number): NonNullable<MediaDto["format"]> {
  if (i % 4 === 3) return "reel";
  return i % 3 === 1 ? "carousel" : "photo";
}

/**
 * Stable made-up recent posts (newest first): what a freshly connected or demo business has.
 * Reach, saves, shares and views are what Instagram would report for the business's own posts.
 */
export function generatedMedia(seed: string, count: number, now = Date.now()): MediaDto[] {
  const h = hash(seed);
  return Array.from({ length: count }, (_, i) => {
    const tone = POST_TONES[(h + i * 3) % POST_TONES.length];
    const likes = 80 + ((h >>> (i % 16)) % 900);
    const format = mockFormat(i);
    const reach = likes * (6 + (i % 5));
    const saves = 5 + ((h >>> ((i + 5) % 16)) % 120);
    const captionIndex = (h + i) % MOCK_CAPTIONS.length;
    return {
      id: `ig_media_${seed}_${i + 1}`,
      caption: MOCK_CAPTIONS[captionIndex],
      mediaUrl: mockMediaUrl(tone),
      mediaType: format === "reel" ? ("video" as const) : ("image" as const),
      format,
      tone,
      icon: POST_ICONS[(h + i * 5) % POST_ICONS.length],
      likes,
      comments: 3 + ((h >>> ((i + 3) % 16)) % 60),
      reach,
      saves,
      shares: mockShares(reach, format, CAPTION_SHARE_PCT[captionIndex]),
      views: format === "reel" ? Math.round(reach * 1.8) : null,
      postedAt: new Date(now - (i * 2 + 1) * DAY - (h % 7) * 3_600_000).toISOString(),
    };
  });
}

const COMPETITOR_CAPTIONS = [
  "Our signature blend is back ☕ #kuwait #specialtycoffee",
  "Weekend offer: 2 for 1 on iced lattes 🧊 #q8 #offer",
  "Behind the scenes at the roastery 🔥 #specialtycoffee",
  "Giveaway! Tag a friend to win a month of coffee 🎁 #giveaway #kuwait",
  "Collab with @sweet.layers — new pistachio cake 🍰 #collab",
  "صباح الخير من فريقنا ☕ #الكويت",
  "New arrival: limited edition beans ✨ #specialtycoffee #q8",
  "عرض نهاية الأسبوع 🔥 خصم 20% #عروض",
] as const;

/**
 * Caption, posting time and format for a competitor's mock post (they post mostly in the
 * evening, spread over the week, at the account's postsPerWeek).
 */
export function mockCompetitorPostDetails(handle: string, index: number, postsPerWeek: number, now = Date.now()): Required<Pick<CompetitorPost, "caption" | "postedAt" | "format">> {
  const h = hash(handle);
  const gapDays = 7 / Math.max(1, postsPerWeek);
  const hourOffset = [19, 20, 13, 21, 9, 18][(h + index) % 6];
  const day = new Date(now - Math.round((index + 0.5) * gapDays * DAY));
  day.setUTCHours(hourOffset - 3, (h >>> index) % 60, 0, 0); // Kuwait is UTC+3
  const formats = ["reel", "carousel", "photo", "reel", "photo", "reel"] as const;
  return {
    caption: COMPETITOR_CAPTIONS[(h + index * 3) % COMPETITOR_CAPTIONS.length],
    postedAt: day.toISOString(),
    format: formats[(h + index) % formats.length],
  };
}

/**
 * A post's share of its final metrics `ageDays` after it went out: most interactions arrive in the
 * first two days (for back-filled snapshot history in the seed).
 */
export function growthShare(ageDays: number): number {
  if (ageDays <= 0) return 0.35;
  return Math.min(1, 1 - 0.65 * Math.exp(-ageDays / 1.6));
}
