// Mock AI answers. Each answer is built from the active account's mock data, so switching accounts
// changes the answers too. Nothing is sent to any AI service.
import { compact, hourLabel, num, pct, signed, weekday } from "@/lib/gallery/format";
import { captionFor } from "./categories";
import { NOW, kuwaitAt } from "./clock";
import { TIME_SLOTS } from "./insights";
import type { Account, Competitor, Insights, L, Lang, Photo } from "./types";


export interface ChatContext {
  account: Account;
  photos: Photo[];
  insights: Insights;
  competitors: Competitor[];
  own: { postsPerWeek: number; engagementRate: number };
  /** A demo business: its photos are the samples, so posts use the sample templates and AI images. */
  demo?: boolean;
}

export interface AiAnswer {
  text: L;
  bullets?: L[];
  chart?: { labels: L[]; values: number[]; highlight: number };
  post?: { photoId: string; caption: L; time: string };
  photoId?: string;
  estimate?: boolean;
}

const both = (f: (lang: Lang) => string): L => ({ en: f("en"), ar: f("ar") });

function bestSlots(ins: Insights, count: number) {
  const cells: { day: number; slot: number; v: number }[] = [];
  ins.bestTimes.forEach((row, day) => row.forEach((v, slot) => cells.push({ day, slot, v })));
  return cells.sort((a, b) => b.v - a.v).slice(0, count);
}

// Sat..Fri as Kuwait dates in the current week, used for weekday names.
const DAY_ISO = Array.from({ length: 7 }, (_, i) => kuwaitAt(i + 1, 12)); // tomorrow is Saturday
const dayName = (day: number, lang: Lang) => weekday(DAY_ISO[day], lang, "long");

export function answer(id: string, ctx: ChatContext): AiAnswer {
  const { account, photos, insights: ins, competitors } = ctx;
  const published = photos.filter((p) => p.status === "published" && p.metrics);

  switch (id) {
    case "post-next": {
      const photo = photos.find((p) => p.status === "none") ?? photos[0];
      // Tomorrow is Saturday (row 0 of the heatmap): use its strongest slot.
      const saturday = ins.bestTimes[0];
      const hour = TIME_SLOTS[saturday.indexOf(Math.max(...saturday))] % 24;
      const at = kuwaitAt(1, hour === 0 ? 23 : hour, hour === 0 ? 30 : 0);
      const caption = captionFor(account, photo, "friendly");
      return {
        text: both((l) =>
          l === "ar"
            ? `اقترح نشر صورة «${photo.dish.ar}» غداً. صور هذا النوع تحصل على حفظ أعلى من المتوسط، والوقت المقترح هو أنشط وقت لمتابعيك.`
            : `I'd post your "${photo.dish.en}" photo tomorrow. Shots like this get more saves than average, and the suggested time is when your followers are most active.`,
        ),
        post: { photoId: photo.id, caption, time: at },
      };
    }
    case "post-caption": {
      const photo = photos[0];
      return {
        text: both((l) => (l === "ar" ? `هذا وصف لصورة «${photo.dish.ar}»:` : `Here's a caption for your "${photo.dish.en}" photo:`)),
        bullets: [
          captionFor(account, photo, "base"),
        ],
        photoId: photo.id,
      };
    }
    case "post-hashtags":
      return {
        text: both((l) =>
          l === "ar"
            ? `استخدم ٥ إلى ٨ هاشتاقات. هذه الأفضل أداءً لحسابك خلال آخر ٣٠ يوماً:`
            : `Use 5 to 8 hashtags. These performed best for your account in the last 30 days:`,
        ),
        bullets: [{ en: account.hashtags.join("  "), ar: account.hashtags.join("  ") }],
      };
    case "an-reach": {
      const labels = Array.from({ length: 7 }, (_, i) => {
        const iso = new Date(NOW.getTime() - (6 - i) * 86_400_000).toISOString();
        return { en: weekday(iso, "en"), ar: weekday(iso, "ar") };
      });
      const max = ins.reachByDay.indexOf(Math.max(...ins.reachByDay));
      const bestIso = new Date(NOW.getTime() - (6 - max) * 86_400_000).toISOString();
      const bestDay = { en: weekday(bestIso, "en", "long"), ar: weekday(bestIso, "ar", "long") };
      return {
        text: both((l) =>
          l === "ar"
            ? `وصلت منشوراتك إلى ${compact(ins.reach, l)} حساب هذا الأسبوع (${signed(ins.reachChange, l)} مقارنة بالأسبوع الماضي). أفضل يوم كان ${bestDay.ar}.`
            : `Your posts reached ${compact(ins.reach, l)} accounts this week (${signed(ins.reachChange, l)} vs last week). Your best day was ${bestDay.en}.`,
        ),
        chart: { labels, values: ins.reachByDay, highlight: max },
      };
    }
    case "an-best": {
      const monthAgo = NOW.getTime() - 30 * 86_400_000;
      const best = [...published]
        .filter((p) => new Date(p.publishedAt!).getTime() > monthAgo)
        .sort((a, b) => b.metrics!.reach - a.metrics!.reach)[0] ?? published[0];
      const m = best.metrics!;
      return {
        text: both((l) =>
          l === "ar"
            ? `أفضل منشور هذا الشهر هو «${best.dish.ar}»: وصل إلى ${compact(m.reach, l)} شخص، مع ${num(m.likes, l)} إعجاب و${num(m.saves, l)} حفظ.`
            : `Your best post this month is "${best.dish.en}": it reached ${compact(m.reach, l)} people, with ${num(m.likes, l)} likes and ${num(m.saves, l)} saves.`,
        ),
        photoId: best.id,
      };
    }
    case "an-shared": {
      const top = [...published].sort((a, b) => b.metrics!.shares - a.metrics!.shares)[0];
      if (!top) return answer("an-best", ctx);
      const m = top.metrics!;
      return {
        text: both((l) =>
          l === "ar"
            ? `أكثر منشور تمت مشاركته هو «${top.dish.ar}»: شاركه ${num(m.shares, l)} شخص ووصل إلى ${compact(m.reach, l)} حساب. المنشورات التي يرسلها الناس لأصدقائهم تجلب متابعين جدداً.`
            : `Your most shared post is "${top.dish.en}": ${num(m.shares, l)} people shared it and it reached ${compact(m.reach, l)} accounts. Posts people send to friends bring in new followers.`,
        ),
        photoId: top.id,
      };
    }
    case "an-when": {
      const top = bestSlots(ins, 3);
      return {
        text: both((l) => (l === "ar" ? "أفضل الأوقات للنشر (بتوقيت الكويت):" : "Your best times to post (Kuwait time):")),
        bullets: top.map((c) => both((l) => `${dayName(c.day, l)} · ${hourLabel(TIME_SLOTS[c.slot], l)}`)),
      };
    }
    case "co-compare": {
      const avgEng = competitors.reduce((s, c) => s + c.engagementRate, 0) / Math.max(1, competitors.length);
      const avgPosts = competitors.reduce((s, c) => s + c.postsPerWeek, 0) / Math.max(1, competitors.length);
      const better = ctx.own.engagementRate >= avgEng;
      return {
        text: both((l) =>
          l === "ar"
            ? `تفاعلك ${pct(ctx.own.engagementRate, l)} مقابل متوسط ${pct(avgEng, l)} لمنافسيك، و${better ? "هذا أعلى منهم" : "هذا أقل منهم"}. أنت تنشر ${num(ctx.own.postsPerWeek, l)} منشورات أسبوعياً مقابل ${num(avgPosts, l, 1)} لهم.`
            : `Your engagement is ${pct(ctx.own.engagementRate, l)} vs a ${pct(avgEng, l)} average for your competitors, so you're ${better ? "ahead" : "behind"}. You post ${ctx.own.postsPerWeek} times a week vs ${num(avgPosts, l, 1)} for them.`,
        ),
        estimate: true,
      };
    }
    case "co-working": {
      const top = [...competitors].sort((a, b) => b.engagementRate - a.engagementRate)[0];
      return {
        text: both((l) =>
          l === "ar"
            ? `@${top.handle} لديه أعلى تفاعل (${pct(top.engagementRate, l)}). ${top.note.ar} ينشرون غالباً ${top.bestDays.ar} ${top.bestTime.ar}.`
            : `@${top.handle} has the highest engagement (${pct(top.engagementRate, l)}). ${top.note.en} They usually post ${top.bestDays.en}, ${top.bestTime.en}.`,
        ),
        estimate: true,
      };
    }
    case "co-fastest": {
      const top = [...competitors].sort((a, b) => b.growth - a.growth)[0];
      return {
        text: both((l) =>
          l === "ar"
            ? `@${top.handle} هو الأسرع نمواً: ${signed(top.growth, l)} متابعين خلال آخر ٣٠ يوماً. ${top.note.ar}`
            : `@${top.handle} is growing fastest: ${signed(top.growth, l)} followers in the last 30 days. ${top.note.en}`,
        ),
        estimate: true,
      };
    }
    default:
      return {
        text: {
          en: "I can't answer that one right now. Try one of the suggested questions below, or ask again in a moment.",
          ar: "لا أستطيع الإجابة عن هذا السؤال الآن. جرّبوا أحد الأسئلة المقترحة أدناه، أو اسألوا مرة أخرى بعد قليل.",
        },
      };
  }
}

/**
 * The sample answer for a typed question its keywords match, or null (see matchQuestion). Chats have no
 * mode, so the rules cover every topic; the more specific ones come first ("best time to post" is about
 * timing, "which post did best" about results, "what should I post" asks for a post).
 */
export function matchRule(text: string): string | null {
  const q = text.toLowerCase();
  const rules: [RegExp, string][] = [
    [/hashtag|هاشتاق|وسم/, "post-hashtags"],
    [/caption|وصف|كابشن/, "post-caption"],
    [/compet|منافس/, "co-compare"],
    [/shar|مشارك/, "an-shared"],
    [/when|time|متى|وقت/, "an-when"],
    [/best|أفضل/, "an-best"],
    [/reach|وصول/, "an-reach"],
    [/post|انشر|أنشر|منشور/, "post-next"],
    [/grow|نمو/, "co-fastest"],
  ];
  return rules.find(([re]) => re.test(q))?.[1] ?? null;
}

/** Pick an answer for typed questions by simple keyword matching; "fallback" says to try a suggested question. */
export function matchQuestion(text: string): string {
  return matchRule(text) ?? "fallback";
}

/**
 * What a question gets at once, before the AI is asked: "post-next" (the post flow, real photos for a real
 * business) or, for demo businesses only, a sample answer its keywords match. Null asks the AI.
 */
export function localAnswerFor(text: string, demo: boolean): string | null {
  const rule = matchRule(text);
  if (rule === "post-next") return rule;
  return demo ? rule : null;
}

export type ChatFallback = { kind: "post" } | { kind: "sample"; answerId: string } | { kind: "honest" };

/**
 * When the AI can't answer: a post question still gets a post; a demo business gets the sample answer
 * (or the note to try a suggested question); a real business never gets sample data, only an honest note.
 */
export function chatFallback(text: string, demo: boolean): ChatFallback {
  const answerId = matchQuestion(text);
  if (answerId === "post-next") return { kind: "post" };
  return demo ? { kind: "sample", answerId } : { kind: "honest" };
}
