import "server-only";
import type { CaptionStyle, PostPurpose, PurposePattern, StyleNotes } from "@/types";
import { getContentCatalog, type CatalogProfile } from "./catalog";

/**
 * AI caption, reply and brand-profile generation. Routes depend on this
 * interface only; pick the implementation with AI_PROVIDER ("mock" until the AI
 * integration lands — add e.g. a `ClaudeAIService` that prompts with the brand
 * context, and a case below).
 */

export interface BrandVoiceInput {
  /** 0 = formal Arabic … 100 = casual Kuwaiti. */
  toneLevel: number;
  brandWords: string[];
  defaultHashtags: string[];
}

/** The parts of a business's BrandContext that steer caption writing. */
export interface BrandContextForCaptions {
  summary: string;
  captionStyle: CaptionStyle;
  purposePatterns: PurposePattern[];
  wordsToUse: string[];
  wordsToAvoid: string[];
}

export interface CaptionRequest {
  businessId: string;
  businessName: string;
  handle: string;
  categoryId: string;
  occasionId: string;
  /** Preferred language; the implementation may mix if omitted. */
  language?: "en" | "ar";
  brandVoice: BrandVoiceInput;
  /** The confirmed brand profile, when the business has one. */
  brandContext?: BrandContextForCaptions | null;
  /** Business profile from onboarding (drives the generic catalogue). */
  profile?: CatalogProfile;
  count: number;
  /** Bump to get different results for the same inputs (regenerate). */
  variant: number;
}

export interface GeneratedCaption {
  caption: string;
  language: "en" | "ar";
}

export interface ReplyRequest {
  businessName: string;
  commentText: string;
  commenterUsername: string;
  brandVoice: BrandVoiceInput;
  /** When set, price questions are pointed to WhatsApp. */
  whatsappNumber: string | null;
}

/** Everything the business entered in onboarding, for building its brand profile. */
export interface BrandContextInput {
  businessName: string;
  businessType: string | null;
  businessTypeOther: string | null;
  location: string;
  description: string | null;
  products: string[];
  targetAudience: string | null;
  languages: Array<"ar" | "en">;
  posts: Array<{
    purpose: PostPurpose;
    purposeOther: string | null;
    purposeNote: string | null;
    caption: string;
    mediaType: "image" | "video";
  }>;
  colors: string[];
  hasLogo: boolean;
  toneLevel: number;
  wordsToUse: string[];
  wordsToAvoid: string[];
  competitorHandles: string[];
}

/** What the AI learned; stored as a BrandContext version. */
export interface BrandContextDraft {
  summary: string;
  visualStyle: StyleNotes;
  captionStyle: CaptionStyle;
  purposePatterns: PurposePattern[];
}

export interface AIService {
  generateCaptions(request: CaptionRequest): Promise<GeneratedCaption[]>;
  draftReply(request: ReplyRequest): Promise<{ text: string; language: "en" | "ar" }>;
  /** Reads the onboarding inputs (business, posts, basics) and describes the brand. */
  buildBrandContext(input: BrandContextInput): Promise<BrandContextDraft>;
}

/** Thrown when the provider can't build a brand profile (the route stores a FAILED version). */
export class BrandContextError extends Error {}

const isArabic = (text: string) => /[؀-ۿ]/.test(text);
const PRICE_WORDS = /price|how much|cost|بكم|كم السعر|سعر/i;
const EMOJI = /\p{Extended_Pictographic}/gu;

export function isPriceQuestion(text: string): boolean {
  return PRICE_WORDS.test(text);
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Removes words the brand asked to avoid, then tidies the spacing left behind. */
function stripAvoided(text: string, avoid: string[]): string {
  let out = text;
  for (const word of avoid) {
    if (word.trim()) out = out.replace(new RegExp(escapeRegExp(word.trim()), "giu"), "");
  }
  return out.replace(/[ \t]{2,}/g, " ").replace(/ +([,.!?،])/g, "$1").trim();
}

// ─── Mock brand-profile builder ──────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  roastery: "coffee and nut roastery",
  cafe: "café",
  restaurant: "restaurant",
  bakery: "bakery",
  sweets: "sweets and dates shop",
  retail: "retail boutique",
  beauty: "beauty salon",
  services: "service business",
};

const PURPOSE_PATTERNS: Record<PostPurpose, (ctx: { name: string; product: string; note: string | null }) => string> = {
  menu_product: ({ product, note }) =>
    `Puts one product front and centre — ${product} — with the name early in the caption and a clear way to order.${note ? ` Goal: ${note}.` : ""}`,
  promotion: ({ note }) =>
    `Leads with the offer and its deadline in the first line, then the reason to act now; works best posted before the weekend.${note ? ` Goal: ${note}.` : ""}`,
  shop_location: ({ name, note }) =>
    `Shows the place itself — the entrance, the counter, the atmosphere — and always repeats where ${name} is and when it's open.${note ? ` Goal: ${note}.` : ""}`,
  service: ({ note }) =>
    `Explains one service through a before/after or a step-by-step, ending with how to book.${note ? ` Goal: ${note}.` : ""}`,
  announcement: ({ product, note }) =>
    `Short, excited news posts — new arrivals like ${product}, restocks or opening hours — with a single emoji-led headline.${note ? ` Goal: ${note}.` : ""}`,
  behind_the_scenes: ({ name, note }) =>
    `Personal, unpolished moments from inside ${name}: preparation, the team, the craft. Captions speak in the first person ("we").${note ? ` Goal: ${note}.` : ""}`,
  other: ({ note }) => `A post type of its own for this brand.${note ? ` Goal: ${note}.` : ""}`,
};

/** Rough colour name for a hex value, for readable style notes. */
function colorName(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 0.08) return l > 0.85 ? "white" : l < 0.18 ? "black" : l > 0.55 ? "light grey" : "charcoal";
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const light = l > 0.72 ? "soft " : l < 0.3 ? "deep " : "";
  if (h < 15 || h >= 345) return `${light}red`;
  if (h < 40) return l < 0.45 ? `${light}brown` : `${light}orange`;
  if (h < 65) return l > 0.6 ? "cream" : `${light}gold`;
  if (h < 160) return `${light}green`;
  if (h < 200) return `${light}teal`;
  if (h < 255) return `${light}blue`;
  if (h < 290) return `${light}purple`;
  return `${light}pink`;
}

function hashtagsFrom(captions: string[]): string[] {
  const tags = captions.flatMap((c) => c.match(/#[\p{L}\p{N}_]+/gu) ?? []);
  return [...new Set(tags)].slice(0, 6);
}

function mockBrandContext(input: BrandContextInput): BrandContextDraft {
  const typeLabel = input.businessType === "other" ? (input.businessTypeOther ?? "local business") : (TYPE_LABELS[input.businessType ?? ""] ?? "local business");
  const products = input.products.length ? input.products : [input.businessName];
  const productList = products.slice(0, 3).join(", ");
  const languages =
    input.languages.length === 2 ? "Arabic and English" : input.languages[0] === "en" ? "English" : "Arabic";
  const place = input.location ? ` in ${input.location}` : "";
  const audience = input.targetAudience ? input.targetAudience : "local customers";

  const summary = [
    `${input.businessName} is a ${typeLabel}${place}, known for ${productList}.`,
    input.description ? input.description.trim().replace(/\.?$/, ".") : null,
    `It speaks to ${audience} on Instagram in ${languages}, ${input.toneLevel < 34 ? "in a polished, formal voice" : input.toneLevel < 67 ? "in a warm, friendly voice" : "in a casual, chatty Kuwaiti voice"}.`,
  ]
    .filter(Boolean)
    .join(" ");

  const names = [...new Set(input.colors.map(colorName))];
  const videos = input.posts.filter((p) => p.mediaType === "video").length;
  const visualTraits = [
    names.length ? `Palette: ${names.slice(0, 3).join(", ")}` : null,
    videos >= 2 ? "Reels-first: short videos carry the feed" : videos === 1 ? "Mostly photos with the occasional reel" : "Photo-led feed",
    input.posts.some((p) => p.purpose === "menu_product") ? "Close-up product shots" : null,
    input.posts.some((p) => p.purpose === "shop_location") ? "Shows the shop and its atmosphere" : null,
    input.hasLogo ? "Logo used as a consistent sign-off" : null,
  ].filter((t): t is string => Boolean(t));
  const visualStyle: StyleNotes = {
    summary: names.length
      ? `A ${names[0]}-led look${names[1] ? ` with ${names[1]}` : ""}${names[2] ? ` and ${names[2]} accents` : ""}. Posts feel consistent because the same colours repeat across products and places.`
      : "A clean, product-first look with plenty of space around the subject.",
    traits: visualTraits,
  };

  const captions = input.posts.map((p) => p.caption).filter((c) => c.trim());
  const avgLength = captions.length ? captions.reduce((n, c) => n + c.length, 0) / captions.length : 0;
  const emojiCount = captions.reduce((n, c) => n + (c.match(EMOJI)?.length ?? 0), 0);
  const arabicShare = captions.length ? captions.filter(isArabic).length / captions.length : 0;
  const captionTraits = [
    avgLength === 0 ? "Captions to be written from scratch" : avgLength < 80 ? "Short, punchy captions" : avgLength < 220 ? "Medium-length captions with one clear message" : "Long, story-telling captions",
    emojiCount === 0 ? "No emojis" : emojiCount / Math.max(1, captions.length) < 2 ? "A few emojis as accents" : "Emoji-rich",
    arabicShare > 0.6 ? "Written mainly in Arabic" : arabicShare > 0.2 ? "Mixes Arabic and English" : captions.length ? "Written mainly in English" : `Planned in ${languages}`,
    input.wordsToUse.length ? `Signature words: ${input.wordsToUse.slice(0, 4).join(", ")}` : null,
    input.wordsToAvoid.length ? `Never says: ${input.wordsToAvoid.slice(0, 4).join(", ")}` : null,
  ].filter((t): t is string => Boolean(t));
  const ownTags = hashtagsFrom(captions);
  const city = input.location.split(/[,،]/)[0]?.trim().toLowerCase().replace(/\s+/g, "");
  const captionStyle: CaptionStyle = {
    summary: `Captions open with the product or the news, keep to one idea, and end with an easy next step (order, visit or DM). ${input.toneLevel >= 67 ? "Casual Kuwaiti phrases make it feel personal." : input.toneLevel < 34 ? "The wording stays formal and respectful." : "Friendly without being too informal."}`,
    traits: captionTraits,
    hashtags: ownTags.length ? ownTags : ["#kuwait", ...(city ? [`#${city}`] : []), `#${(input.businessType ?? "local").replace(/_/g, "")}`],
  };

  const seen = new Set<string>();
  const purposePatterns: PurposePattern[] = [];
  for (const post of input.posts) {
    const key = post.purpose === "other" ? `other:${post.purposeOther ?? ""}` : post.purpose;
    if (seen.has(key)) continue;
    seen.add(key);
    const product = products[purposePatterns.length % products.length];
    purposePatterns.push({
      purpose: post.purpose,
      label: post.purpose === "other" ? (post.purposeOther ?? null) : null,
      description: PURPOSE_PATTERNS[post.purpose]({ name: input.businessName, product, note: post.purposeNote }),
    });
  }

  return { summary, visualStyle, captionStyle, purposePatterns };
}

/** MOCK: fills the business's caption templates with product names and brand words. */
export class MockAIService implements AIService {
  async generateCaptions(request: CaptionRequest): Promise<GeneratedCaption[]> {
    const catalog = getContentCatalog(request.businessId, request.businessName, request.profile);
    const category = catalog.categories.find((c) => c.id === request.categoryId) ?? catalog.categories[0];
    const exact = catalog.templates.filter((t) => t.occasionId === request.occasionId);
    const generic = catalog.templates.filter((t) => t.occasionId === "*");
    let pool = [...exact, ...generic];
    if (request.language) pool = pool.filter((t) => t.language === request.language).concat(pool.filter((t) => t.language !== request.language));
    const context = request.brandContext;
    const ownWords = request.brandVoice.brandWords.length ? request.brandVoice.brandWords : catalog.brandVocabulary;
    const words = [...new Set([...(context?.wordsToUse ?? []), ...ownWords])];
    const avoid = context?.wordsToAvoid ?? [];

    return Array.from({ length: request.count }, (_, slot) => {
      const template = pool[(slot + request.variant) % pool.length];
      const product = category.productNames[(slot + request.variant) % category.productNames.length];
      const word = words.length ? words[(slot * 2 + request.variant) % words.length] : "";
      const body = template.text
        .replaceAll("{product}", product)
        .replaceAll("{handle}", request.handle)
        .replaceAll("{word}", word)
        .replace(/\n\s*—\s*/g, "\n")
        .replace(/^\s*—\s*/gm, "");
      const hashtags = [...new Set([...template.hashtags, ...(context?.captionStyle.hashtags.slice(0, 3) ?? []), ...request.brandVoice.defaultHashtags])].join(" ");
      return { caption: stripAvoided(`${body}\n\n${hashtags}`, avoid), language: template.language };
    });
  }

  async draftReply(request: ReplyRequest) {
    const arabic = isArabic(request.commentText);
    const name = request.commenterUsername.split(/[._]/)[0];
    if (isPriceQuestion(request.commentText) && request.whatsappNumber) {
      const wa = `wa.me/${request.whatsappNumber.replace(/\D/g, "")}`;
      return arabic
        ? { text: `هلا ${name} 🤍 أرسلنا لك قائمة الأسعار، وتقدر تطلب مباشرة على الواتساب: ${wa}`, language: "ar" as const }
        : { text: `Hi ${name}! 👋 We've sent you our price list — you can also order on WhatsApp: ${wa}`, language: "en" as const };
    }
    return arabic
      ? { text: `تسلم ${name} 🤍 نورتنا! أي سؤال إحنا موجودين بالخاص.`, language: "ar" as const }
      : { text: `Thank you ${name}! 🤍 Send us a DM if there's anything we can help with.`, language: "en" as const };
  }

  /**
   * MOCK: describes the brand from the onboarding inputs with templates.
   * Takes a moment like a real model call. For testing the failure path, a
   * business description containing "[ai-fail]" makes the build fail.
   */
  async buildBrandContext(input: BrandContextInput): Promise<BrandContextDraft> {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    if (input.description?.includes("[ai-fail]")) throw new BrandContextError("Mock AI failure requested by the business description.");
    return mockBrandContext(input);
  }
}

let instance: AIService | null = null;

export function getAIService(): AIService {
  if (instance) return instance;
  const provider = process.env.AI_PROVIDER ?? "mock";
  switch (provider) {
    case "mock":
      instance = new MockAIService();
      break;
    default:
      throw new Error(`Unknown AI_PROVIDER "${provider}".`);
  }
  return instance;
}
