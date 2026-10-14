/**
 * The business's focus — niche, main aim, goals, timeline and an optional example caption —
 * as prompt lines, so every AI call (assistant and recommendations data block, captions,
 * replies, brand profile, weekly summary) works towards the same aim. English, since the
 * prompts are. Pure (no server-only) so it can be unit-tested.
 */

export interface BusinessFocus {
  niche: string | null;
  aim: string | null;
  goals: string[];
  timeline: string | null;
  exampleCaption?: string | null;
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
  ].filter((l): l is string => l !== null);
}
