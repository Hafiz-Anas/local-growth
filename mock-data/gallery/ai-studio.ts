// Mock "AI studio": post drafts, directions and inspiration built from the active account's mock data.
// Nothing is sent to any AI service; every caption comes from the templates below.
import type { CompetitorPostRef } from "@/lib/gallery/competitor-posts";
import { suggestedTime } from "@/lib/gallery/suggest";
import { captionFor as categoryCaption, categoriesFor, findCategory, hashtagsFor as categoryTags, type Category } from "./categories";
import { NOW, ago } from "./clock";
import type { Account, AccountId, CaptionTone, Competitor, Insights, L, Photo } from "./types";

/* ---------- Types ---------- */

export type Direction = "warm" | "promo" | "minimal";
export type InspoStyle = "question" | "story" | "list";
export type PostStatus = "new" | "scheduled" | "posted" | "draft" | "saved";

/** A mock AI image: an existing photo of the same category, shown with its own look. */
export interface AiImage {
  src: string;
  thumb: string;
  look: number;
  dish: L;
  category?: string;
  credit: { author: string; link: string };
}

/** One of the AI images offered for a post; `photoId` is set once it's picked and saved to the gallery. */
export interface Variant extends AiImage {
  photoId?: string;
}

export interface PostDraft {
  photoIds: string[];
  /** AI images similar to the user's photo; the user picks one or keeps the original. */
  variants?: Variant[];
  /** Picked variant; undefined keeps the original photo. */
  variant?: number;
  originalId?: string;
  /** A combined AI image not yet in the gallery (combine directions). Saved when the direction is chosen. */
  aiImage?: AiImage;
  caption: L;
  hashtags: string[];
  time: string; // ISO
  tone: CaptionTone | Direction | InspoStyle;
  direction?: Direction;
  inspiredBy?: string;
  status: PostStatus;
  edited?: boolean;
  /** The real draft (PostDraft) this post was saved as; later edits update it. */
  draftId?: string;
  /** Earlier captions Regenerate replaced, newest first ("Earlier captions" on the card). */
  versions?: { caption: L; hashtags: string[]; at: string }[];
  /** A real business's post: "ai" when the AI wrote the caption, "template" for the neutral fallback. */
  captionSource?: "ai" | "template";
}

export type StepKey = "look" | "style" | "product" | "caption" | "hashtags" | "time" | "directions" | "images" | "combine";

export type FeatureKey = "angle" | "colors" | "lighting" | "plating" | "background";
/** What the AI took from one photo when combining. */
export interface Feature {
  photoId: string;
  key: FeatureKey;
}
export interface Step {
  key: StepKey;
  /** A handle or product name shown in the step label. */
  v?: L;
}

export type AiMsg =
  | { id: string; role: "user"; text: L; photoIds?: string[]; refThumb?: string; reference?: CompetitorPostRef }
  | { id: string; role: "ai"; kind: "answer"; answerId: string }
  | { id: string; role: "ai"; kind: "text"; text: L }
  | { id: string; role: "ai"; kind: "post"; text?: L; steps: Step[]; ready: boolean; post: PostDraft }
  | { id: string; role: "ai"; kind: "directions"; text?: L; steps: Step[]; ready: boolean; options: PostDraft[]; chosen?: number; features?: Feature[] }
  | { id: string; role: "ai"; kind: "pickInspiration"; chosen?: string }
  | { id: string; role: "ai"; kind: "pickProduct"; chosen?: string };

export interface AiChat {
  id: string;
  title: L;
  at: string; // ISO, last activity
  messages: AiMsg[];
}

export interface StudioContext {
  account: Account;
  photos: Photo[];
  insights: Pick<Insights, "bestTimes">;
  competitors: Competitor[];
}

/* ---------- Per-account brand details (from onboarding) ---------- */

export interface Product {
  id: string;
  name: L;
  price: L;
  detail: L;
  /** Matched against photo dish names (English). */
  match: RegExp;
}

interface Brand {
  cta: L;
  offer: L;
  products: Product[];
}

const BRANDS: Record<AccountId, Brand> = {
  mathanet: {
    cta: { en: "Order by DM 🍲", ar: "اطلبوا بالخاص 🍲" },
    offer: { en: "free delivery on orders over 10 KD", ar: "توصيل مجاني للطلبات فوق ١٠ د.ك" },
    products: [
      { id: "machboos", name: { en: "Chicken machboos", ar: "مجبوس دجاج" }, price: { en: "3.500 KD", ar: "٣٫٥٠٠ د.ك" }, detail: { en: "Serves 2 · ready by 1 PM", ar: "يكفي شخصين · جاهز الساعة ١" }, match: /machboos|biryani|kabsa|mandi/i },
      { id: "saloona", name: { en: "Lamb saloona", ar: "صالونة لحم" }, price: { en: "4.000 KD", ar: "٤٫٠٠٠ د.ك" }, detail: { en: "With saffron rice", ar: "مع عيش زعفران" }, match: /saloona|stew/i },
      { id: "grill", name: { en: "Mixed grill platter", ar: "صينية مشاوي مشكلة" }, price: { en: "6.500 KD", ar: "٦٫٥٠٠ د.ك" }, detail: { en: "Serves 3 – 4", ar: "يكفي ٣ – ٤ أشخاص" }, match: /grill|kebab/i },
      { id: "mezze", name: { en: "Mezze tray", ar: "صينية مقبلات" }, price: { en: "2.750 KD", ar: "٢٫٧٥٠ د.ك" }, detail: { en: "Hummus, mutabbal, fattoush", ar: "حمص، متبل، فتوش" }, match: /mezze|hummus|mutabbal|starters|fattoush/i },
      { id: "sweets", name: { en: "Lugaimat & sweets box", ar: "بوكس لقيمات وحلويات" }, price: { en: "2.000 KD", ar: "٢٫٠٠٠ د.ك" }, detail: { en: "20 pieces with date syrup", ar: "٢٠ حبة مع دبس" }, match: /lugaimat|sweets|baklava|ma'amoul/i },
    ],
  },
  qahwa: {
    cta: { en: "See you in Salmiya ☕", ar: "نشوفكم بالسالمية ☕" },
    offer: { en: "2-for-1 every day, 3 – 5 PM", ar: "واحد والثاني مجاناً يومياً من ٣ إلى ٥ العصر" },
    products: [
      { id: "saffron", name: { en: "Saffron latte", ar: "لاتيه بالزعفران" }, price: { en: "1.750 KD", ar: "١٫٧٥٠ د.ك" }, detail: { en: "Our signature drink", ar: "مشروبنا المميز" }, match: /saffron|spanish latte|pistachio latte/i },
      { id: "iced", name: { en: "Iced coffee", ar: "القهوة المثلجة" }, price: { en: "1.500 KD", ar: "١٫٥٠٠ د.ك" }, detail: { en: "Cold brew, iced latte, iced mocha", ar: "كولد برو، آيس لاتيه، آيس موكا" }, match: /iced|cold brew/i },
      { id: "matcha", name: { en: "Matcha", ar: "ماتشا" }, price: { en: "1.900 KD", ar: "١٫٩٠٠ د.ك" }, detail: { en: "Ceremonial grade, hot or iced", ar: "درجة أولى، حار أو بارد" }, match: /matcha/i },
      { id: "cakes", name: { en: "House cakes", ar: "كيك البيت" }, price: { en: "1.500 KD", ar: "١٫٥٠٠ د.ك" }, detail: { en: "Date, honey and caramel cake", ar: "كيكة التمر والعسل والكراميل" }, match: /cake|tiramisu|loaf/i },
    ],
  },
  tannour: {
    cta: { en: "Pre-order on our website 🥐", ar: "اطلبوا مسبقاً من موقعنا 🥐" },
    offer: { en: "10% off pre-orders this weekend", ar: "خصم ١٠٪ على الطلبات المسبقة هالويكند" },
    products: [
      { id: "croissant", name: { en: "Butter croissants", ar: "كرواسون بالزبدة" }, price: { en: "0.650 KD", ar: "٠٫٦٥٠ د.ك" }, detail: { en: "Baked every morning at 6", ar: "ينخبز كل يوم الساعة ٦ الصبح" }, match: /croissant|pain au chocolat/i },
      { id: "sourdough", name: { en: "Sourdough loaf", ar: "رغيف ساوردو" }, price: { en: "1.800 KD", ar: "١٫٨٠٠ د.ك" }, detail: { en: "48-hour fermentation", ar: "تخمير ٤٨ ساعة" }, match: /sourdough|loaf|loaves|bread|baguette/i },
      { id: "cakes", name: { en: "Celebration cakes", ar: "كيك المناسبات" }, price: { en: "from 12 KD", ar: "من ١٢ د.ك" }, detail: { en: "Order 48 hours ahead", ar: "الطلب قبلها بـ٤٨ ساعة" }, match: /cake/i },
      { id: "cookies", name: { en: "Cookie box", ar: "بوكس كوكيز" }, price: { en: "3.000 KD", ar: "٣٫٠٠٠ د.ك" }, detail: { en: "Box of 12, mix and match", ar: "١٢ حبة، اختاروا النكهات" }, match: /cookies/i },
    ],
  },
};

export const brandFor = (accountId: string) => BRANDS[accountId as AccountId] ?? BRANDS.mathanet;
export const productsFor = (accountId: string) => brandFor(accountId).products;

/* ---------- Caption templates ---------- */

const PROMO: L = { en: "{dish} 🔥 This week only: {offer}. {cta}", ar: "{dish} 🔥 هذا الأسبوع فقط: {offer}. {cta}" };

const STYLES: Record<InspoStyle, L> = {
  question: {
    en: "How do you like your {dish}? 👇 Tell us in the comments, we read every one. {cta}",
    ar: "كيف تحبون {dish}؟ 👇 قولوا لنا بالتعليقات، نقرأها كلها. {cta}",
  },
  story: {
    en: "Every {dish} starts early in the morning, long before you see it here. This one took its time, and it shows. {cta}",
    ar: "كل {dish} يبدأ من الصبح بدري، قبل لا تشوفونه هني بوقت طويل. هذا أخذ وقته، ويبين. {cta}",
  },
  list: {
    en: "3 reasons our {dish} sells out:\n1. Made fresh today\n2. No shortcuts\n3. Made with love\n{cta}",
    ar: "٣ أسباب تخلي {dish} يخلص بسرعة:\n١. طازج اليوم\n٢. بدون اختصارات\n٣. مسوّى بحب\n{cta}",
  },
};

export const STYLE_LABEL: Record<InspoStyle, L> = {
  question: { en: "a question that invites comments", ar: "سؤال يشجّع على التعليق" },
  story: { en: "a short behind-the-scenes story", ar: "قصة قصيرة من وراء الكواليس" },
  list: { en: "a quick numbered list", ar: "قائمة قصيرة مرقّمة" },
};

type Subject = Pick<Photo, "dish" | "category">;

const fillWith = (template: L, photo: Pick<Photo, "dish">, brand: Brand): L => ({
  en: template.en.replaceAll("{dish}", photo.dish.en).replaceAll("{offer}", brand.offer.en).replaceAll("{cta}", brand.cta.en),
  ar: template.ar.replaceAll("{dish}", photo.dish.ar).replaceAll("{offer}", brand.offer.ar).replaceAll("{cta}", brand.cta.ar),
});

/** Captions follow the photo's category (a sweets photo gets a sweets caption), in the chosen tone. */
function captionFor(ctx: StudioContext, photo: Subject, tone: PostDraft["tone"]): L {
  const brand = brandFor(ctx.account.id);
  if (tone === "warm") return categoryCaption(ctx.account, photo, "friendly");
  if (tone === "minimal") return categoryCaption(ctx.account, photo, "shorter");
  if (tone === "promo") return fillWith(PROMO, photo, brand);
  if (tone in STYLES) return fillWith(STYLES[tone as InspoStyle], photo, brand);
  return categoryCaption(ctx.account, photo, tone as CaptionTone);
}

function hashtagsFor(ctx: StudioContext, tone: PostDraft["tone"], photo: Subject) {
  const tags = categoryTags(ctx.account, photo.category);
  if (tone === "minimal" || tone === "shorter") return tags.slice(0, 3);
  if (tone === "promo") return tags.slice(1, 6);
  return tags.slice(0, 5);
}

/** The final caption as posted: text plus hashtags. */
export const fullCaption = (post: PostDraft): L => ({
  en: `${post.caption.en}\n\n${post.hashtags.join(" ")}`.trim(),
  ar: `${post.caption.ar}\n\n${post.hashtags.join(" ")}`.trim(),
});

/* ---------- Generators ---------- */

function draft(ctx: StudioContext, photoIds: string[], tone: PostDraft["tone"], extra?: Partial<PostDraft>, subject?: Subject): PostDraft {
  const photo = subject ?? ctx.photos.find((p) => p.id === photoIds[0]) ?? ctx.photos[0];
  return { photoIds, caption: captionFor(ctx, photo, tone), hashtags: hashtagsFor(ctx, tone, photo), time: suggestedTime(ctx.insights), tone, status: "new", ...extra };
}

/** Rewrite a post's caption in another tone, keeping everything else. */
export function retone(ctx: StudioContext, post: PostDraft, tone: CaptionTone): PostDraft {
  const photo = ctx.photos.find((p) => p.id === post.photoIds[0]) ?? ctx.photos[0];
  return { ...post, tone, caption: captionFor(ctx, photo, tone), edited: false };
}

/** Photos people usually want to post next: not published yet, uploads first. */
export function unposted(photos: Photo[]) {
  const rank = (p: Photo) => (p.status === "published" ? 3 : p.source === "upload" && p.status === "none" ? 0 : p.status === "none" ? 1 : 2);
  return [...photos].sort((a, b) => rank(a) - rank(b));
}

export function photoPost(ctx: StudioContext, photoIds: string[]): PostDraft {
  return draft(ctx, photoIds, "base");
}

export const PHOTO_STEPS: Step[] = [{ key: "look" }, { key: "caption" }, { key: "hashtags" }, { key: "time" }];
export const VARIANT_STEPS: Step[] = [{ key: "look" }, { key: "caption" }, { key: "hashtags" }, { key: "images" }, { key: "time" }];

/* ---------- Recognising photos ---------- */

const words = (s: string) => s.toLowerCase().split(/[^a-z']+/).filter((w) => w.length > 3);

const categoryLabel = (ctx: StudioContext, photo: Photo): L | undefined => findCategory(ctx.account.id, photo.category)?.name;

/** "This looks like kunafa from your Sweets album." Built from each photo's name and category. */
export function recognise(ctx: StudioContext, photos: Photo[]): L {
  const known = photos.filter((p) => p.category);
  if (known.length === 0)
    return {
      en: "I couldn't tell what's in this photo, so I kept the post general. Add it to a category album and I'll match the next one.",
      ar: "لم أتعرّف على محتوى الصورة، فكتبت منشوراً عاماً. أضفها إلى ألبوم فئة وسأطابق المنشور القادم.",
    };
  const names = (lang: "en" | "ar") => {
    const list = [...new Set(known.map((p) => (lang === "en" ? p.dish.en.toLowerCase() : p.dish.ar)))];
    const and = lang === "en" ? " and " : " و";
    return list.length > 1 ? `${list.slice(0, -1).join(lang === "en" ? ", " : "، ")}${and}${list[list.length - 1]}` : list[0];
  };
  const cats = [...new Set(known.map((p) => p.category))];
  const many = photos.length > 1;
  if (cats.length === 1) {
    const label = categoryLabel(ctx, known[0])!;
    return {
      en: `${many ? "These look like" : "This looks like"} ${names("en")} from your ${label.en} album.`,
      ar: `${many ? "تبدو هذه الصور" : "تبدو هذه"} ${names("ar")} من ألبوم ${label.ar}.`,
    };
  }
  const labels = cats.map((c) => categoryLabel(ctx, known.find((p) => p.category === c)!)!);
  return {
    en: `These look like ${names("en")}, from your ${labels.map((x) => x.en).join(" and ")} albums.`,
    ar: `تبدو هذه الصور ${names("ar")}، من ألبومات ${labels.map((x) => x.ar).join(" و")}.`,
  };
}

/** 3 AI images like the photo: the same shot restyled, then the closest photos of the same item or category. */
export function similarImages(ctx: StudioContext, photo: Photo): Variant[] {
  if (!photo.category) return [];
  const own = new Set(words(photo.dish.en));
  const score = (p: Photo) => words(p.dish.en).filter((w) => own.has(w)).length;
  const pool = ctx.photos
    .filter((p) => p.category === photo.category && p.id !== photo.id && p.source !== "ai" && p.src !== photo.src)
    .map((p, i) => ({ p, s: score(p), i }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.p);
  const bases = [photo, ...pool].slice(0, 3);
  // Each image keeps the name of what it shows, so a picked one is saved (and captioned) as that item.
  return bases.map((b, i) => ({ src: b.src, thumb: b.thumb, look: [1, 2, 3][i], dish: b.dish, category: photo.category, credit: b.credit }));
}

/** The caption rewritten for another photo of the post (a picked AI image), in the same tone. */
export function recaption(ctx: StudioContext, post: PostDraft, subject: Subject): PostDraft {
  return { ...post, caption: captionFor(ctx, subject, post.tone) };
}

/** A photo post plus AI images to pick from (single photo, or the cover of a carousel). */
export function postWithVariants(ctx: StudioContext, base: PostDraft): PostDraft {
  const photo = ctx.photos.find((p) => p.id === base.photoIds[0]);
  if (!photo || photo.source === "ai") return base;
  const variants = similarImages(ctx, photo);
  return variants.length ? { ...base, variants, originalId: photo.id } : base;
}

/* ---------- Combining photos ---------- */

export const FEATURE_LABEL: Record<FeatureKey, L> = {
  angle: { en: "Camera angle", ar: "زاوية التصوير" },
  colors: { en: "Colors", ar: "الألوان" },
  lighting: { en: "Lighting", ar: "الإضاءة" },
  plating: { en: "Plating", ar: "طريقة التقديم" },
  background: { en: "Background", ar: "الخلفية" },
};

const FEATURE_WORDS: [FeatureKey, RegExp][] = [
  ["angle", /angle|top.?down|overhead|زاوي/i],
  ["colors", /colou?r|tone|palette|لون|ألوان/i],
  ["lighting", /light|إضاء|ضوء/i],
  ["plating", /plat|present|arrang|تقديم|ترتيب/i],
  ["background", /background|backdrop|table|خلفي/i],
];

/** Features in the order the user asked for them, then the usual ones, one per photo. */
export function combineFeatures(photoIds: string[], text: string): Feature[] {
  const asked = FEATURE_WORDS.map(([key, re]) => ({ key, at: text.search(re) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.key);
  const order = [...new Set<FeatureKey>([...asked, "angle", "colors", "lighting", "plating"])];
  return photoIds.map((photoId, i) => ({ photoId, key: order[i] }));
}

/** The category the user named ("for my Sweets category"), else the most common one in the photos. */
export function combineCategory(ctx: StudioContext, photos: Photo[], text: string) {
  const named = categoryInText(ctx.account.id, text);
  if (named) return named;
  const counts = new Map<string, number>();
  for (const p of photos) if (p.category) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

const GENERIC = new Set(["dishes", "coffee", "family", "our"]);

/** A category named in the prompt, in English (whole words, singular or plural) or Arabic. */
function categoryInText(accountId: string, text: string) {
  const lower = text.toLowerCase();
  return categoriesFor(accountId).find((c) => {
    const names = [c.id, ...c.name.en.toLowerCase().split(/[^a-zé]+/)].filter((w) => w.length > 2 && !GENERIC.has(w));
    const en = names.some((w) => new RegExp(`\\b${w.replace(/s$/, "")}s?\\b`).test(lower));
    return en || text.includes(c.name.ar) || text.includes(c.name.ar.replace(/^ال/, ""));
  })?.id;
}

/** 3 directions, each on a new AI image that mixes the photos (shown with its own look until it's picked). */
export function combineDirections(ctx: StudioContext, photos: Photo[], category: string | undefined): PostDraft[] {
  const subjectPhoto = photos.find((p) => p.category === category) ?? photos[0];
  const subject: Subject = { dish: subjectPhoto.dish, category: category ?? subjectPhoto.category };
  // The new image builds on the photo from the asked-for category, so a Sweets post never shows another dish.
  const base = subjectPhoto;
  const order: Direction[] = ["warm", "promo", "minimal"];
  return order.map((d, i) =>
    draft(ctx, [base.id], d, { direction: d, aiImage: { src: base.src, thumb: base.thumb, look: [2, 3, 1][i], dish: subject.dish, category: subject.category, credit: base.credit } }, subject),
  );
}

/** 3 directions (warm, promotional, minimal), each on its own photo when there are enough. */
export function directions(ctx: StudioContext, photoIds: string[]): PostDraft[] {
  const order: Direction[] = ["warm", "promo", "minimal"];
  return order.map((d, i) => draft(ctx, [photoIds[i % photoIds.length]], d, { direction: d }));
}

export const DIRECTION_LABEL: Record<Direction, L> = {
  warm: { en: "Warm & homely", ar: "دافئ وبيتي" },
  promo: { en: "Promotional", ar: "ترويجي" },
  minimal: { en: "Minimal", ar: "بسيط" },
};

/** Photos of a product: Uploads first, then the rest of the library. */
export function productPhotos(photos: Photo[], product: Product) {
  const hits = unposted(photos.filter((p) => product.match.test(p.dish.en)));
  const fromUploads = hits.filter((p) => p.source === "upload");
  const list = (fromUploads.length ? [...fromUploads, ...hits.filter((p) => p.source !== "upload")] : hits).slice(0, 3);
  return { photos: list.length ? list : unposted(photos).slice(0, 3), where: fromUploads.length ? ("uploads" as const) : list.length ? ("library" as const) : ("none" as const) };
}

/* ---------- Inspiration ---------- */

export interface InspoSource {
  id: string;
  handle: string;
  thumb: string;
  style: InspoStyle;
  own: boolean;
  /** Reach for own posts, followers for competitors. */
  stat: number;
}

const STYLE_CYCLE: InspoStyle[] = ["question", "list", "story"];

export function inspirationSources(ctx: StudioContext): { own: InspoSource[]; competitors: InspoSource[] } {
  const top = ctx.photos
    .filter((p) => p.status === "published" && p.metrics)
    .sort((a, b) => b.metrics!.reach - a.metrics!.reach)
    .slice(0, 6);
  return {
    own: top.map((p, i) => ({ id: `own:${p.id}`, handle: ctx.account.handle, thumb: p.thumb, style: STYLE_CYCLE[(i + 2) % 3], own: true, stat: p.metrics!.reach })),
    competitors: ctx.competitors.flatMap((c, ci) =>
      c.thumbs.map((thumb, i) => ({ id: `comp:${c.id}:${i}`, handle: c.handle, thumb, style: STYLE_CYCLE[(ci + i) % 3], own: false, stat: c.followers })),
    ),
  };
}

export function findSource(ctx: StudioContext, id: string) {
  const { own, competitors } = inspirationSources(ctx);
  return [...own, ...competitors].find((s) => s.id === id);
}

/** A new post in the style of the source, on one of the user's own photos. The caption is never copied. */
export function inspiredPost(ctx: StudioContext, source: InspoSource): PostDraft {
  const photo = unposted(ctx.photos)[source.own ? 1 : 0] ?? ctx.photos[0];
  return draft(ctx, [photo.id], source.style, { inspiredBy: source.handle });
}

/* ---------- A post like a competitor's ("Create a similar post") ---------- */

/** What the chat reads from a competitor's post: never their image, and their caption only to learn from. */
export interface CompetitorSource {
  handle: string;
  caption: string;
  icon: string;
  format?: string;
}

/** The kind of caption the competitor wrote, read from how it's written. */
export function competitorStyle(caption: string): InspoStyle {
  if (/[?؟]/.test(caption)) return "question";
  if (/(^|\n)\s*([0-9٠-٩]+[.)]|[-•])\s/m.test(caption)) return "list";
  return "story";
}

/** What the competitor's picture shows (its artwork icon) → the owner's categories most likely to match, in order. */
const ICON_CATEGORIES: Record<string, string[]> = {
  cake: ["sweets", "desserts", "cakes", "treats"],
  nut: ["sweets", "desserts", "treats", "pastries"],
  gift: ["sweets", "cakes", "treats", "desserts"],
  coffee: ["hot", "cafe", "iced"],
  cup: ["iced", "hot", "matcha"],
  bag: ["spreads", "pastries", "bread", "cafe"],
  sparkles: ["spreads", "cakes", "desserts", "main"],
  gem: ["desserts", "cakes", "sweets"],
};

/** The owner's category closest to the competitor's post: words in its caption first, then what its picture shows. */
export function matchCategory(ctx: StudioContext, source: CompetitorSource): string | undefined {
  const cats = categoriesFor(ctx.account.id);
  const text = source.caption.toLowerCase();
  const named = cats.find((c) => {
    const names = [c.id, ...c.name.en.toLowerCase().split(/[^a-zé]+/)].filter((w) => w.length > 3 && !GENERIC.has(w));
    return names.some((w) => text.includes(w.replace(/s$/, ""))) || source.caption.includes(c.name.ar.replace(/^ال/, ""));
  });
  if (named) return named.id;
  const dish = ctx.photos.find((p) => p.category && (words(p.dish.en).some((w) => text.includes(w)) || source.caption.includes(p.dish.ar)));
  if (dish) return dish.category;
  return (ICON_CATEGORIES[source.icon] ?? []).find((id) => cats.some((c) => c.id === id));
}

/** The owner's own photo for the new post: one not posted yet, from the matching category when there is one. */
export function similarPhoto(ctx: StudioContext, category: string | undefined): Photo {
  const pool = unposted(ctx.photos).filter((p) => p.source !== "ai" && p.category);
  return (category ? pool.find((p) => p.category === category) : undefined) ?? pool[0] ?? ctx.photos[0];
}

/** A new post in the competitor's kind of caption, on the owner's photo, from the templates. Nothing is copied. */
export function similarPost(ctx: StudioContext, photoId: string, style: InspoStyle, handle: string): PostDraft {
  return draft(ctx, [photoId], style, { inspiredBy: handle });
}

const FORMAT_LABEL: Record<string, L> = {
  reel: { en: "A short Reel", ar: "ريل قصير" },
  video: { en: "A short video", ar: "فيديو قصير" },
  carousel: { en: "A carousel", ar: "كاروسيل" },
  photo: { en: "A single photo", ar: "صورة واحدة" },
};

const HOOKS: [RegExp, L][] = [
  [/giveaway|win |prize|سحب|مسابقة|هدية/i, { en: "a giveaway that asks people to comment, so the post spreads", ar: "سحب يطلب من الناس التعليق، فينتشر المنشور" }],
  [/%|\boff\b|offer|sale|deal|عرض|خصم/i, { en: "a limited-time offer in the first line, so people act now", ar: "عرض لفترة محدودة في أول سطر، فيتحرك الناس الآن" }],
  [/[?؟]/, { en: "a question that gets people answering in the comments", ar: "سؤال يخلي الناس يردون بالتعليقات" }],
  [/behind|morning|every day|team|كواليس|الصبح|صباح|فريق/i, { en: "a peek behind the scenes that makes it feel personal", ar: "لمحة من وراء الكواليس تخليه قريب من الناس" }],
  [/new|launch|back|just|جديد|وصل|رجع/i, { en: "news of something new, which makes followers curious", ar: "خبر عن شي جديد يثير فضول المتابعين" }],
];

/** What a competitor's picture shows (its artwork icon), when their caption names none of the owner's categories. */
const ICON_SUBJECT: Record<string, L> = {
  coffee: { en: "coffee", ar: "القهوة" },
  cup: { en: "their drinks", ar: "مشروباتهم" },
  cake: { en: "cakes and sweets", ar: "الكيك والحلويات" },
  nut: { en: "nuts and sweets", ar: "المكسرات والحلويات" },
  gift: { en: "gift boxes", ar: "بوكسات الهدايا" },
};

/**
 * Why the competitor's post works — the sample answer when the AI isn't available. Read from its format and
 * caption, no numbers. `category` is the owner's category their post matches (matchCategory), if any.
 */
export function whyItWorks(source: CompetitorSource, style: InspoStyle, category: Category | undefined): { topic: L; style: L; hook: L } {
  const format = FORMAT_LABEL[source.format ?? "photo"] ?? FORMAT_LABEL.photo;
  const subject: L = category ? { en: category.name.en.toLowerCase(), ar: category.name.ar } : (ICON_SUBJECT[source.icon] ?? { en: "what they sell", ar: "منتجاتهم" });
  const hook = HOOKS.find(([re]) => re.test(source.caption))?.[1] ?? { en: "a strong first line and a close-up picture that stops the scroll", ar: "أول سطر قوي وصورة قريبة توقف التمرير" };
  return {
    topic: { en: `${format.en} about ${subject.en}, shown up close.`, ar: `${format.ar} عن ${subject.ar}، بلقطة قريبة.` },
    style: { en: `Written as ${STYLE_LABEL[style].en}.`, ar: `مكتوب على شكل ${STYLE_LABEL[style].ar}.` },
    hook: { en: `It opens with ${hook.en}.`, ar: `يبدأ بـ${hook.ar}.` },
  };
}

/* ---------- Seed chats so the history isn't empty ---------- */

export function seedChats(ctx: StudioContext): AiChat[] {
  const photo = unposted(ctx.photos)[0];
  const competitor = [...ctx.competitors].sort((a, b) => b.growth - a.growth)[0];
  const chats: AiChat[] = [
    {
      id: `seed-${ctx.account.id}-1`,
      title: { en: "What should I post tomorrow?", ar: "ماذا أنشر غداً؟" },
      at: ago(1, 2),
      messages: [
        { id: "s1u", role: "user", text: { en: "What should I post tomorrow?", ar: "ماذا أنشر غداً؟" } },
        {
          id: "s1a",
          role: "ai",
          kind: "post",
          ready: true,
          steps: PHOTO_STEPS,
          text: { en: `Your "${photo.dish.en}" photo hasn't been posted yet. Here's a post for it:`, ar: `صورة «${photo.dish.ar}» لم تُنشر بعد. هذا منشور جاهز لها:` },
          post: photoPost(ctx, [photo.id]),
        },
      ],
    },
    {
      id: `seed-${ctx.account.id}-2`,
      title: { en: "How did my reach change this week?", ar: "كيف تغيّر الوصول هذا الأسبوع؟" },
      at: ago(2, 5),
      messages: [
        { id: "s2u", role: "user", text: { en: "How did my reach change this week?", ar: "كيف تغيّر الوصول هذا الأسبوع؟" } },
        { id: "s2a", role: "ai", kind: "answer", answerId: "an-reach" },
      ],
    },
  ];
  if (competitor)
    chats.push({
      id: `seed-${ctx.account.id}-3`,
      title: { en: "Who is growing fastest?", ar: "من الأسرع نمواً؟" },
      at: ago(4, 1),
      messages: [
        { id: "s3u", role: "user", text: { en: "Who is growing fastest?", ar: "من الأسرع نمواً؟" } },
        { id: "s3a", role: "ai", kind: "answer", answerId: "co-fastest" },
      ],
    });
  return chats;
}

export const nowIso = () => NOW.toISOString();
