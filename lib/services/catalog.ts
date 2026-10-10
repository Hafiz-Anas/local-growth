import "server-only";
import { POST_PURPOSES, type PostPurpose } from "@/config/onboarding";
import { CLIENT_DATA } from "@/mock-data/client-data";
import type { CaptionTemplate, MediaIcon, MediaTone, Occasion, PostGeneratorData } from "@/types";

/** What onboarding told us about a business: its products and the purposes of its example posts. */
export interface CatalogProfile {
  products: string[];
  /** Purposes of the brand posts, most used first. */
  purposes: PostPurpose[];
}

/** Each post purpose is offered as an occasion / angle in the Post Generator. */
const PURPOSE_OCCASIONS: Record<PostPurpose, Omit<Occasion, "id">> = {
  menu_product: { label: "Menu / product", labelAr: "منيو / منتج" },
  promotion: { label: "Promotion / discount", labelAr: "عرض / خصم" },
  shop_location: { label: "Shop / location", labelAr: "المحل / الموقع" },
  service: { label: "Service", labelAr: "خدمة" },
  announcement: { label: "Announcement / new arrival", labelAr: "إعلان / وصل حديثاً" },
  behind_the_scenes: { label: "Behind the scenes", labelAr: "خلف الكواليس" },
  other: { label: "Something else", labelAr: "شي ثاني" },
};

/** Caption templates per purpose — MOCK content until the AI integration lands. */
const PURPOSE_TEMPLATES: CaptionTemplate[] = [
  { id: "p_menu_en", occasionId: "menu_product", language: "en", text: "Meet {product} ✨ Order now — just send us a DM.", hashtags: ["#kuwait"] },
  { id: "p_menu_ar", occasionId: "menu_product", language: "ar", text: "تعرفوا على {product} ✨ اطلبوا الحين بالخاص", hashtags: ["#الكويت"] },
  { id: "p_promo_en", occasionId: "promotion", language: "en", text: "Offer time 🎉 {product} at a special price this week only. Don't miss it!", hashtags: ["#kuwait", "#offers"] },
  { id: "p_promo_ar", occasionId: "promotion", language: "ar", text: "عرض خاص 🎉 {product} بسعر مميز هالأسبوع بس. لا يفوتكم!", hashtags: ["#الكويت", "#عروض"] },
  { id: "p_shop_en", occasionId: "shop_location", language: "en", text: "Come say hi 📍 {product} is waiting for you at @{handle}", hashtags: ["#kuwait"] },
  { id: "p_shop_ar", occasionId: "shop_location", language: "ar", text: "حياكم عندنا 📍 {product} بانتظاركم", hashtags: ["#الكويت"] },
  { id: "p_service_en", occasionId: "service", language: "en", text: "Book your {product} today — {word}, done right.", hashtags: ["#kuwait"] },
  { id: "p_service_ar", occasionId: "service", language: "ar", text: "احجزوا {product} اليوم ✨ {word}", hashtags: ["#الكويت"] },
  { id: "p_news_en", occasionId: "announcement", language: "en", text: "Just arrived: {product} 🙌 {word}", hashtags: ["#kuwait", "#new"] },
  { id: "p_news_ar", occasionId: "announcement", language: "ar", text: "وصل حديثاً: {product} 🙌 {word}", hashtags: ["#الكويت", "#جديد"] },
  { id: "p_bts_en", occasionId: "behind_the_scenes", language: "en", text: "Behind the scenes: how we prepare {product} every morning ☕ {word}", hashtags: ["#kuwait"] },
  { id: "p_bts_ar", occasionId: "behind_the_scenes", language: "ar", text: "خلف الكواليس: كيف نجهز {product} كل صباح ☕ {word}", hashtags: ["#الكويت"] },
  { id: "g1", occasionId: "*", language: "en", text: "Meet {product} — now at @{handle} ✨", hashtags: ["#kuwait"] },
  { id: "g2", occasionId: "*", language: "ar", text: "تعرفوا على {product} ✨ متوفر الحين عند @{handle}", hashtags: ["#الكويت"] },
];

const PRODUCT_STYLES: Array<{ icon: MediaIcon; tone: MediaTone }> = [
  { icon: "bag", tone: "sand" },
  { icon: "gift", tone: "rose" },
  { icon: "sparkles", tone: "latte" },
  { icon: "cup", tone: "pistachio" },
  { icon: "gem", tone: "berry" },
  { icon: "cake", tone: "date" },
];

/** Purposes the business used first, then the rest, as generator occasions. */
export function purposeOccasions(used: PostPurpose[]): Occasion[] {
  const ordered = [...new Set([...used, ...POST_PURPOSES])];
  return ordered.map((purpose) => ({ id: purpose, ...PURPOSE_OCCASIONS[purpose] }));
}

/**
 * Product categories, occasions and caption templates for the Post Generator.
 * MOCK: the seeded demo businesses read their mock packs. Every other business
 * gets one category per product it listed in onboarding and the post purposes
 * as occasions. Replace with a table (or the AI provider) when the real
 * product catalogue lands.
 */
export function getContentCatalog(businessId: string, businessName: string, profile?: CatalogProfile): PostGeneratorData {
  const pack = CLIENT_DATA[businessId];
  if (pack) return pack.generator;
  const products = profile?.products.length ? profile.products : [businessName];
  return {
    categories: products.map((name, i) => ({
      id: `product_${i + 1}`,
      label: name,
      labelAr: name,
      productNames: [name],
      ...PRODUCT_STYLES[i % PRODUCT_STYLES.length],
    })),
    occasions: purposeOccasions(profile?.purposes ?? []),
    brandVocabulary: [],
    templates: PURPOSE_TEMPLATES,
  };
}
