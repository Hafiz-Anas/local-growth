/**
 * The business's focus — niche, main aim, goals, timeline, an optional example caption, and from
 * onboarding its products / menu categories, targets, the feeling posts should have, its location
 * in Kuwait and its photo style guide — as prompt lines, so every AI call (assistant and
 * recommendations data block, captions, replies, brand profile, weekly summary) works towards the
 * same aim. English, since the prompts are. Pure (no server-only) so it can be unit-tested.
 * Loaded per business by lib/server/business-focus.ts.
 */

import { styleGuideLine, type StyleGuideText } from "./style";

export interface BusinessFocus {
  niche: string | null;
  aim: string | null;
  goals: string[];
  timeline: string | null;
  exampleCaption?: string | null;
  /** Main products or menu categories (left out where the data block already lists them). */
  products?: string[];
  /** What they want more of (config/onboarding.ts TARGETS), with an optional number. */
  targets?: Array<{ key: string; number?: number | null }>;
  /** How posts should feel (FEELINGS) plus their own word. */
  feelings?: string[];
  feelingOther?: string | null;
  /** "Salmiya, Hawalli" (config/kuwait.ts locationLabel). */
  location?: string | null;
  /** delivery | shop | both */
  serviceMode?: string | null;
  /** The photo style guide read from their best photos. */
  style?: StyleGuideText | null;
}

const AIM_TEXT: Record<string, string> = {
  more_customers: "get more customers and orders",
  more_followers: "grow followers",
  more_engagement: "get more likes, comments and shares",
  brand_awareness: "make more people know the brand",
  more_visits: "bring more people to the shop",
};

const GOAL_TEXT: Record<string, string> = {
  post_consistently: "post consistently",
  grow_reach: "reach more people",
  more_inquiries: "get more questions and DMs",
  promote_offers: "promote offers",
  launch_products: "launch new products",
  build_community: "build a loyal community",
};

const TIMELINE_TEXT: Record<string, string> = {
  "1_month": "the next month",
  "3_months": "the next 3 months",
  "6_months": "the next 6 months",
  ongoing: "ongoing, no deadline",
};

const TARGET_TEXT: Record<string, string> = {
  sales: "more sales",
  followers: "more followers",
  visits: "more visits to the shop",
  messages: "more messages and enquiries",
};

const FEELING_TEXT: Record<string, string> = {
  tempting: "tempting (makes people want it now)",
  intriguing: "intriguing (makes people curious)",
  homely: "homely and warm",
  premium: "premium and elegant",
  fun: "fun and playful",
};

const SERVICE_TEXT: Record<string, string> = {
  delivery: "delivery only (no shop to visit)",
  shop: "a shop customers visit (no delivery)",
  both: "a shop customers can visit, and delivery",
};

const clean = (text: string, max: number) => text.replace(/\s+/g, " ").trim().slice(0, max);

export const aimText = (aim: string | null) => (aim ? (AIM_TEXT[aim] ?? null) : null);

/** Lines for a prompt; empty when nothing is set. */
export function focusLines(focus: BusinessFocus): string[] {
  const goals = focus.goals.map((g) => GOAL_TEXT[g]).filter(Boolean);
  return [
    focus.niche ? `Niche / theme: ${focus.niche}` : null,
    aimText(focus.aim) ? `Main aim on Instagram: ${aimText(focus.aim)}` : null,
    goals.length ? `Goals: ${goals.join(", ")}` : null,
    focus.timeline && TIMELINE_TEXT[focus.timeline] ? `Timeline: ${TIMELINE_TEXT[focus.timeline]}` : null,
    focus.exampleCaption?.trim() ? `Example caption the owner gave (their voice): "${focus.exampleCaption.replace(/\s+/g, " ").trim().slice(0, 400)}"` : null,
    ...onboardingLines(focus),
  ].filter((l): l is string => l !== null);
}

/** The onboarding answers (products, targets, feeling, location, photo style); empty when none were given. */
function onboardingLines(focus: BusinessFocus): Array<string | null> {
  const products = (focus.products ?? []).map((p) => clean(p, 60)).filter(Boolean);
  const targets = (focus.targets ?? [])
    .filter((t) => TARGET_TEXT[t.key])
    .map((t) => (t.number ? `${TARGET_TEXT[t.key]} (target: ${t.number})` : TARGET_TEXT[t.key]));
  const feelings = [...(focus.feelings ?? []).map((f) => FEELING_TEXT[f]).filter(Boolean), ...(focus.feelingOther?.trim() ? [clean(focus.feelingOther, 60)] : [])];
  const service = focus.serviceMode ? SERVICE_TEXT[focus.serviceMode] : undefined;
  const style = focus.style ? styleGuideLine(focus.style) : null;
  return [
    products.length ? `Main products / menu categories: ${products.slice(0, 10).join(", ")}` : null,
    targets.length ? `Wants: ${targets.join(", ")}` : null,
    feelings.length ? `Posts should feel: ${feelings.join(", ")}` : null,
    focus.location?.trim() ? `Location: ${clean(focus.location, 80)}, Kuwait${service ? ` — ${service}` : ""}` : service ? `Serves customers by: ${service}` : null,
    style ? `Photo style: ${style}` : null,
  ];
}
