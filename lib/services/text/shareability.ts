import type { Method } from "../../analysis/methods";
import type { DayPart, PostFormat, Weekday } from "../../analysis/posts";
import { SHARE_MIN_REACH, sharePatterns, type ShareabilityData, type SharePattern, type SharePost } from "../../analysis/shareability";
import { TextGenerationError } from "./errors";
import { summaryUsesOnlyGivenNumbers } from "./report";

/**
 * Shareability findings: why some posts get sent to friends and others don't. The numbers come
 * from lib/analysis/shareability.ts as a labelled data block; the AI (or the mock, from the same
 * numbers) writes 1–3 plain findings, each quoting the owner's own numbers. Any number in an answer
 * that isn't in the block rejects it. Pure; tested in tests/shareability.test.ts.
 */

/** Bump when the prompt or the data block changes, so cached findings are rewritten. */
export const SHAREABILITY_PROMPT_VERSION = 1;
export const MAX_FINDINGS = 3;

export interface ShareFinding {
  en: string;
  ar: string;
}

const FORMAT: Record<PostFormat, { en: string; ar: string }> = {
  reel: { en: "Reels", ar: "الريلز" },
  carousel: { en: "carousels", ar: "المنشورات متعددة الصور" },
  photo: { en: "photos", ar: "الصور" },
  video: { en: "videos", ar: "الفيديوهات" },
};
const TOPIC: Record<Method, { en: string; ar: string }> = {
  collaboration: { en: "collaborations", ar: "التعاونات" },
  giveaway: { en: "giveaways", ar: "السحوبات والهدايا" },
  offer: { en: "offers", ar: "العروض" },
  product: { en: "product posts", ar: "منشورات المنتجات" },
  behind_the_scenes: { en: "behind-the-scenes posts", ar: "منشورات خلف الكواليس" },
  announcement: { en: "announcements", ar: "منشورات الأخبار" },
  other: { en: "other posts", ar: "المنشورات الأخرى" },
};
const DAY: Record<Weekday, { en: string; ar: string }> = {
  mon: { en: "Monday", ar: "الاثنين" },
  tue: { en: "Tuesday", ar: "الثلاثاء" },
  wed: { en: "Wednesday", ar: "الأربعاء" },
  thu: { en: "Thursday", ar: "الخميس" },
  fri: { en: "Friday", ar: "الجمعة" },
  sat: { en: "Saturday", ar: "السبت" },
  sun: { en: "Sunday", ar: "الأحد" },
};
const PART: Record<DayPart, { en: string; ar: string; range: string }> = {
  morning: { en: "morning", ar: "الصباح", range: "06–12" },
  afternoon: { en: "afternoon", ar: "الظهر", range: "12–17" },
  evening: { en: "evening", ar: "المساء", range: "17–22" },
  night: { en: "night", ar: "الليل", range: "22–06" },
};

const times = (v: number | null) => (v === null ? "" : ` (${v}x the account average)`);
const postsWord = (n: number) => (n === 1 ? "1 post" : `${n} posts`);

function postLine(p: SharePost): string {
  const topic = p.topic ? `, ${TOPIC[p.topic].en}` : "";
  return `- ${p.ratePct}%${times(p.vsAverage)}: ${FORMAT[p.format].en.replace(/s$/, "")}${topic}, posted ${DAY[p.weekday].en} ${PART[p.dayPart].en}; ${p.shares} shares, reach ${p.reach}. Caption: "${p.caption.replace(/\s+/g, " ").slice(0, 160)}"`;
}

function groupLine<K extends string>(label: string, groups: Array<{ key: K; posts: number; ratePct: number; vsAverage: number | null }>, name: (k: K) => string): string {
  return `${label}: ${groups.map((g) => `${name(g.key)} ${g.ratePct}%${g.vsAverage !== null ? ` (${g.vsAverage}x)` : ""} over ${postsWord(g.posts)}`).join("; ") || "none"}`;
}

/** The only numbers a finding may quote. */
export function shareabilityDataBlock(data: ShareabilityData, { demo = false }: { demo?: boolean } = {}): string {
  return [
    demo ? "This is the app's demo data, not the business's real results." : null,
    `Share rate = shares ÷ reach (both measured by Instagram; reach is Instagram's estimate). Posts reached by fewer than ${SHARE_MIN_REACH} accounts are left out.`,
    `Posts with a share rate: ${data.posts}. Left out: ${data.excluded.lowReach} with low reach, ${data.excluded.unavailable} without share data.`,
    data.averagePct !== null ? `Account average share rate: ${data.averagePct}% (${data.totalShares} shares over a reach of ${data.totalReach}).` : "Too few posts for an account average.",
    "",
    "Most-shared posts:",
    ...data.top.map(postLine),
    "",
    "Least-shared posts:",
    ...data.bottom.map(postLine),
    "",
    groupLine("By post type", data.groups.format, (k) => FORMAT[k].en),
    groupLine("By topic (estimated from the caption or set by the owner)", data.groups.topic, (k) => TOPIC[k].en),
    groupLine("By day (business timezone)", data.groups.weekday, (k) => DAY[k].en),
    groupLine("By time of day (business timezone)", data.groups.dayPart, (k) => `${PART[k].en} (${PART[k].range})`),
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

export const SHAREABILITY_SCHEMA = {
  type: "OBJECT",
  properties: {
    findings: {
      type: "ARRAY",
      description: `1–${MAX_FINDINGS} findings, strongest first.`,
      items: {
        type: "OBJECT",
        properties: {
          finding_en: { type: "STRING", description: "1–2 short sentences: the pattern with the numbers behind it, then what to post next." },
          finding_ar: { type: "STRING", description: "The same in Arabic." },
        },
        required: ["finding_en", "finding_ar"],
      },
    },
  },
  required: ["findings"],
};

const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\*\*/g, "").replace(/\s+/g, " ").trim().slice(0, 400) : "");

/** The model's JSON → 1–3 findings; empty or invented numbers reject the answer. */
export function parseShareFindings(answer: string, data: string): ShareFinding[] {
  let json: { findings?: unknown } | null = null;
  try {
    json = JSON.parse(answer.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    throw new TextGenerationError("bad_output", "The model's share findings weren't valid JSON.", 200);
  }
  const items = Array.isArray(json?.findings) ? json.findings : [];
  const findings = items
    .map((f) => ({ en: clean((f as Record<string, unknown>)?.finding_en), ar: clean((f as Record<string, unknown>)?.finding_ar) }))
    .filter((f) => f.en && f.ar)
    .slice(0, MAX_FINDINGS);
  if (!findings.length) throw new TextGenerationError("bad_output", "The model's share findings were empty.", 200);
  if (!findings.every((f) => summaryUsesOnlyGivenNumbers(f.en, data) && summaryUsesOnlyGivenNumbers(f.ar, data))) {
    throw new TextGenerationError("bad_output", "The model's share findings quoted numbers that aren't in the data.", 200);
  }
  return findings;
}

// ── The mock: findings written in code from the strongest patterns ─────────────

function patternName(p: SharePattern): { en: string; ar: string } {
  if (p.dimension === "format") return FORMAT[p.key as PostFormat];
  if (p.dimension === "topic") return TOPIC[p.key as Method];
  if (p.dimension === "weekday") return { en: `posts on ${DAY[p.key as Weekday].en}`, ar: `منشورات يوم ${DAY[p.key as Weekday].ar}` };
  return { en: `posts in the ${PART[p.key as DayPart].en}`, ar: `منشورات ${PART[p.key as DayPart].ar}` };
}

function nextIdea(p: SharePattern): { en: string; ar: string } {
  if (p.direction === "below") return { en: "Give them something worth sending to a friend, like a tip or a surprise.", ar: "أضيفوا لها شيئاً يستحق الإرسال لصديق، مثل نصيحة أو مفاجأة." };
  if (p.dimension === "format") return { en: `Make your next post one of these.`, ar: "اجعلوا منشوركم القادم من هذا النوع." };
  if (p.dimension === "topic") return { en: "Plan another one this week.", ar: "خطّطوا لواحد آخر هذا الأسبوع." };
  return { en: "Try your next post at that time.", ar: "جرّبوا نشر منشوركم القادم في هذا الوقت." };
}

/**
 * MOCK findings: up to three of the strongest patterns (at most one "below"), or the most-shared
 * post when nothing stands out. Every number comes from the data block. Empty below
 * SHARE_MIN_POSTS_FOR_PATTERNS posts.
 */
export function mockShareFindings(data: ShareabilityData): ShareFinding[] {
  if (!data.top.length || data.averagePct === null) return [];
  const avg = data.averagePct;
  const patterns = sharePatterns(data);
  const picked: SharePattern[] = [];
  for (const p of patterns) {
    if (picked.length === MAX_FINDINGS) break;
    if (p.direction === "below" && picked.some((x) => x.direction === "below")) continue;
    // One finding per dimension keeps them different.
    if (picked.some((x) => x.dimension === p.dimension)) continue;
    picked.push(p);
  }
  if (!picked.length) {
    const best = data.top[0];
    return [
      {
        en: `Your most-shared post was a ${FORMAT[best.format].en.replace(/s$/, "")} on ${DAY[best.weekday].en}: ${best.ratePct}% of the people it reached shared it, ${best.vsAverage}x your average of ${avg}%. Post more like it.`,
        ar: `أكثر منشور تمت مشاركته كان ${FORMAT[best.format].ar} يوم ${DAY[best.weekday].ar}: شاركه ${best.ratePct}% ممن وصلهم، أي ${best.vsAverage} ضعف متوسطكم البالغ ${avg}%. انشروا المزيد مثله.`,
      },
    ];
  }
  return picked.map((p) => {
    const name = patternName(p);
    const idea = nextIdea(p);
    const g = p.group;
    const capital = name.en.charAt(0).toUpperCase() + name.en.slice(1);
    return p.direction === "above"
      ? {
          en: `${capital} get shared the most: ${g.ratePct}% of the people they reach share them, ${g.vsAverage}x your average of ${avg}% (${postsWord(g.posts)}). ${idea.en}`,
          ar: `${name.ar} تُشارَك أكثر: يشاركها ${g.ratePct}% ممن تصلهم، أي ${g.vsAverage} ضعف متوسطكم البالغ ${avg}%، عدد المنشورات: ${g.posts}. ${idea.ar}`,
        }
      : {
          en: `${capital} get shared less: ${g.ratePct}% of the people they reach, against your average of ${avg}% (${postsWord(g.posts)}). ${idea.en}`,
          ar: `${name.ar} تُشارَك أقل: ${g.ratePct}% ممن تصلهم، مقابل متوسطكم البالغ ${avg}%، عدد المنشورات: ${g.posts}. ${idea.ar}`,
        };
  });
}

/** The findings and the headline numbers, for the weekly Recommendations' data block. */
export function shareabilityFactLines(data: ShareabilityData, findings: ShareFinding[]): string[] {
  if (data.averagePct === null) return [];
  return [
    "",
    "## Shareability (how often people send a post to friends; Instagram ranks posts heavily on this)",
    `Share rate = shares ÷ reach, measured by Instagram, over ${postsWord(data.posts)} (posts reached by fewer than ${SHARE_MIN_REACH} accounts left out). Account average: ${data.averagePct}%.`,
    ...data.mostShared.map(postLine),
    groupLine("By post type", data.groups.format, (k) => FORMAT[k].en),
    groupLine("By topic", data.groups.topic, (k) => TOPIC[k].en),
    groupLine("By day", data.groups.weekday, (k) => DAY[k].en),
    ...(findings.length ? ["Findings (written from these numbers):", ...findings.map((f) => `- ${f.en}`)] : []),
  ];
}
