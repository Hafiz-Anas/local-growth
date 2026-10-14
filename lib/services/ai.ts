import "server-only";
import { logIntegration } from "@/lib/server/integration-log";
import type { CaptionStyle, PostPurpose, PurposePattern, StyleNotes } from "@/types";
import { getContentCatalog, type CatalogProfile } from "./catalog";
import { TextGenerationError, sanitizeTextError } from "./text/errors";
import { TextRequestGate } from "./text/gate";
import { DEFAULT_GEMINI_TEXT_MODEL, DEFAULT_GEMINI_TEXT_RPD, DEFAULT_GEMINI_TEXT_RPM, generateGeminiText, readGeminiTextConfig } from "./text/gemini";
import { composeCaption, cleanReply, greetName, isArabic, parseBrandContext, parseCaptions, replyLanguage, stripAvoided } from "./text/output";
import { brandContextPrompt, captionPrompt, replyPrompt, type TextPrompt } from "./text/prompts";

/**
 * AI caption, reply and brand-profile generation. Routes depend on this
 * interface only; pick the implementation with AI_PROVIDER: "mock" (templates,
 * no API calls) or "gemini" (Google's Gemini text model with GEMINI_API_KEY,
 * falling back to the mock's text on any failure). To add another provider
 * (e.g. OpenAI), implement AIService with the prompts in ./text/prompts.ts and
 * add a case to getAIService(). Pure Gemini code lives in ./text (tested in tests/gemini).
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
  /** The business's own Arabic name, so Arabic text never transliterates the English one. */
  businessNameAr?: string | null;
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
  /** For the integration log when the real model fails. */
  businessId?: string;
  businessName: string;
  /** The business's own Arabic name, so Arabic replies never transliterate the English one. */
  businessNameAr?: string | null;
  /** The comment, or for a DM the customer's message(s). */
  commentText: string;
  commenterUsername: string;
  brandVoice: BrandVoiceInput;
  /** A public reply under a comment (default) or a private direct-message reply. */
  channel?: "comment" | "dm";
}

/** Everything the business entered in onboarding, for building its brand profile. */
export interface BrandContextInput {
  /** For the integration log when the real model fails. */
  businessId?: string;
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

const PRICE_WORDS = /price|how much|cost|بكم|كم السعر|سعر/i;
const EMOJI = /\p{Extended_Pictographic}/gu;

export function isPriceQuestion(text: string): boolean {
  return PRICE_WORDS.test(text);
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
    const name = greetName(request.commenterUsername);
    if (request.channel === "dm") {
      // A DM sender's username isn't always known (Meta may not share it).
      const to = name ? ` ${name}` : "";
      return arabic
        ? { text: `هلا${to} 🤍 شكراً على رسالتكم! وصلتنا وبنرد عليكم بالتفاصيل بأقرب وقت.`, language: "ar" as const }
        : { text: `Hi${to}! 🤍 Thanks for your message — we've got it and will get back to you with the details shortly.`, language: "en" as const };
    }
    return arabic
      ? { text: `شكراً ${name} 🤍 نورتونا! أي سؤال إحنا موجودين بالخاص.`, language: "ar" as const }
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

type AICall = "ai.captions" | "ai.reply.comment" | "ai.reply.dm" | "ai.brand_context";

/**
 * Gemini text model (prompts in ./text/prompts.ts). Never fails: when the
 * model can't answer (quota, billing, key, timeout, safety block, malformed
 * answer) it returns the mock's text and logs the reason to the integration
 * log. A request gate keeps calls within the free tier (GEMINI_TEXT_RPM / GEMINI_TEXT_RPD).
 */
export class GeminiAIService implements AIService {
  private readonly mock = new MockAIService();
  private gate: TextRequestGate | null = null;
  private lastBudgetLog = 0;
  private dailyBudgetLoggedUntil = 0;

  private async run<T>(
    call: AICall,
    businessId: string | null | undefined,
    prompt: () => TextPrompt,
    toResult: (answer: string) => T | Promise<T>,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const config = readGeminiTextConfig();
    const gate = (this.gate ??= new TextRequestGate(config?.rpm ?? DEFAULT_GEMINI_TEXT_RPM, config?.rpd ?? DEFAULT_GEMINI_TEXT_RPD));
    const model = config?.model ?? DEFAULT_GEMINI_TEXT_MODEL;
    const decision = gate.acquire();
    if (!decision.allowed) {
      // Paused after a failure: that failure is already in the log. Over our own budget: the daily one is
      // logged once per day, the per-minute one at most once a minute.
      if (decision.budget && decision.reason === "daily_limit") {
        if (this.dailyBudgetLoggedUntil !== decision.until) {
          this.dailyBudgetLoggedUntil = decision.until;
          await logIntegration({ businessId: businessId ?? null, provider: "gemini", level: "warning", call, errorCode: "daily_limit", message: `Reached the daily request budget (GEMINI_TEXT_RPD) — using the template text until ${new Date(decision.until).toISOString()}.`, details: { model, fallback: "template", resetsAt: new Date(decision.until).toISOString() } });
        }
      } else if (decision.budget && Date.now() - this.lastBudgetLog > 60_000) {
        this.lastBudgetLog = Date.now();
        await logIntegration({ businessId: businessId ?? null, provider: "gemini", level: "warning", call, errorCode: "rate_limited", message: "Over the per-minute request budget (GEMINI_TEXT_RPM) — used the template text instead.", details: { model, fallback: "template" } });
      }
      return fallback();
    }
    try {
      if (!config) throw new TextGenerationError("not_configured", "GEMINI_API_KEY is not set.");
      return await toResult(await generateGeminiText(config, prompt()));
    } catch (error) {
      const failure = error instanceof TextGenerationError ? error : new TextGenerationError("unavailable", sanitizeTextError((error as Error).message));
      gate.failed(failure.reason, failure.retryAfterMs);
      await logIntegration({
        businessId: businessId ?? null,
        provider: "gemini",
        level: "error",
        call,
        errorCode: failure.reason,
        httpStatus: failure.httpStatus,
        message: `${failure.message} — used the template text instead.`,
        details: { model, fallback: "template", ...(failure.providerCode && { providerCode: failure.providerCode }) },
      });
      return fallback();
    }
  }

  async generateCaptions(request: CaptionRequest): Promise<GeneratedCaption[]> {
    const catalog = getContentCatalog(request.businessId, request.businessName, request.profile);
    const category = catalog.categories.find((c) => c.id === request.categoryId) ?? catalog.categories[0];
    const occasion = catalog.occasions.find((o) => o.id === request.occasionId);
    const context = request.brandContext;
    const ownWords = request.brandVoice.brandWords.length ? request.brandVoice.brandWords : catalog.brandVocabulary;
    const avoid = context?.wordsToAvoid ?? [];
    // The only hashtags a caption may carry: the brand profile's and the business's defaults.
    const allowedTags = [...new Set([...(context?.captionStyle.hashtags ?? []), ...request.brandVoice.defaultHashtags])];

    return this.run(
      "ai.captions",
      request.businessId,
      () =>
        captionPrompt({
          businessName: request.businessName,
          businessNameAr: request.businessNameAr ?? null,
          handle: request.handle,
          categoryLabel: category.label,
          productNames: category.productNames,
          occasionLabel: occasion?.label ?? request.occasionId,
          language: request.language,
          firstLanguage: request.variant % 2 === 0 ? "en" : "ar",
          count: request.count,
          variant: request.variant,
          toneLevel: request.brandVoice.toneLevel,
          wordsToUse: [...new Set([...(context?.wordsToUse ?? []), ...ownWords])],
          wordsToAvoid: avoid,
          hashtags: allowedTags,
          brandSummary: context?.summary || null,
          captionStyle: context?.captionStyle ?? null,
          purposePattern: context?.purposePatterns.find((p) => p.purpose === request.occasionId)?.description ?? null,
        }),
      async (answer) => {
        const captions = parseCaptions(answer).slice(0, request.count).map((c) => composeCaption(c, allowedTags, request.brandVoice.defaultHashtags, avoid));
        // Fewer than asked for: top up with template captions rather than failing.
        if (captions.length < request.count) {
          captions.push(...(await this.mock.generateCaptions({ ...request, count: request.count - captions.length, variant: request.variant + captions.length })));
        }
        return captions;
      },
      () => this.mock.generateCaptions(request),
    );
  }

  async draftReply(request: ReplyRequest) {
    const channel = request.channel ?? "comment";
    const language = replyLanguage(request.commentText);
    return this.run(
      channel === "dm" ? "ai.reply.dm" : "ai.reply.comment",
      request.businessId,
      () =>
        replyPrompt({
          businessName: request.businessName,
          businessNameAr: request.businessNameAr ?? null,
          text: request.commentText,
          greetName: greetName(request.commenterUsername),
          language,
          channel,
          toneLevel: request.brandVoice.toneLevel,
          brandWords: request.brandVoice.brandWords,
        }),
      (answer) => ({ text: cleanReply(answer), language }),
      () => this.mock.draftReply(request),
    );
  }

  async buildBrandContext(input: BrandContextInput): Promise<BrandContextDraft> {
    return this.run(
      "ai.brand_context",
      input.businessId,
      () => brandContextPrompt(input),
      (answer) => {
        const draft = parseBrandContext(answer);
        // No usable post types from the model: keep the template ones so the generator still has angles.
        return draft.purposePatterns.length ? draft : { ...draft, purposePatterns: mockBrandContext(input).purposePatterns };
      },
      async () => mockBrandContext(input),
    );
  }
}

export type AIProvider = "mock" | "gemini";

export function aiProvider(): AIProvider {
  const value = process.env.AI_PROVIDER ?? "mock";
  if (value === "mock" || value === "gemini") return value;
  throw new Error(`Unknown AI_PROVIDER "${value}".`);
}

let instance: { provider: AIProvider; service: AIService } | null = null;

export function getAIService(): AIService {
  const provider = aiProvider();
  if (instance?.provider === provider) return instance.service;
  instance = { provider, service: provider === "gemini" ? new GeminiAIService() : new MockAIService() };
  return instance.service;
}
