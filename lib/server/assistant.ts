import "server-only";
import { accountStats } from "@/lib/analysis/posts";
import { db } from "@/lib/db";
import type { AssistantMode as DbMode } from "@/lib/generated/prisma/client";
import { isFeatureEnabled } from "@/lib/permissions";
import { getAIService } from "@/lib/services/ai";
import { getInstagramService } from "@/lib/services/instagram";
import {
  ASSISTANT_HISTORY_TURNS,
  chatTitle,
  formatFacts,
  questionLanguage,
  type AssistantFacts,
  type AssistantMode,
  type FactsScope,
} from "@/lib/services/text/assistant";
import type { AssistantConversationDto, AssistantMessageDto, AssistantOverviewDto, AssistantReplyDto, AssistantThreadDto, Permissions } from "@/types";
import { currentBrandContext, postingLanguages } from "./brand";
import { competitorAnalysis } from "./competitor-analysis";
import { listCompetitors } from "./data";
import { ApiError, notFound } from "./http";
import { getInstagramAccount, needsReconnect } from "./instagram-account";
import { methodsOverview } from "./methods";
import { ownPosts } from "./post-data";

/**
 * The client AI assistant: chat history per business, and the data each
 * answer is grounded in (the business's stored Instagram data, brand profile
 * and tracked competitors — formatted by lib/services/text/assistant.ts).
 * Only answered turns are saved; when the AI is unavailable the route answers
 * 503 `assistant_unavailable` with the reason and nothing is stored.
 */

/** Questions per business per rolling 24 hours, so one business can't use up the shared daily AI budget. */
export const ASSISTANT_DAILY_QUESTIONS = 40;
const DAY = 24 * 60 * 60 * 1000;

const TO_DB: Record<AssistantMode, DbMode> = { post: "POST", analytics: "ANALYTICS", competitors: "COMPETITORS" };
const FROM_DB: Record<DbMode, AssistantMode> = { POST: "post", ANALYTICS: "analytics", COMPETITORS: "competitors" };

/** Modes this business can use: Competitors needs the competitors feature (an OFF feature is removed, not grayed out). */
export function assistantModes(permissions: Permissions): AssistantMode[] {
  return isFeatureEnabled(permissions, "competitors") ? ["post", "analytics", "competitors"] : ["post", "analytics"];
}

const MESSAGE_SELECT = { id: true, role: true, mode: true, content: true, language: true, createdAt: true } as const;
type MessageRow = { id: string; role: "USER" | "ASSISTANT"; mode: DbMode; content: string; language: string; createdAt: Date };

const toMessage = (row: MessageRow): AssistantMessageDto => ({
  id: row.id,
  role: row.role === "USER" ? "user" : "assistant",
  mode: FROM_DB[row.mode],
  content: row.content,
  language: row.language === "ar" ? "ar" : "en",
  createdAt: row.createdAt.toISOString(),
});
const toConversation = (row: { id: string; title: string; updatedAt: Date }): AssistantConversationDto => ({ id: row.id, title: row.title, updatedAt: row.updatedAt.toISOString() });

async function questionsToday(businessId: string): Promise<number> {
  return db.assistantMessage.count({ where: { role: "USER", createdAt: { gte: new Date(Date.now() - DAY) }, conversation: { businessId } } });
}

export async function getAssistantOverview(businessId: string, permissions: Permissions): Promise<AssistantOverviewDto> {
  const [rows, used] = await Promise.all([
    db.assistantConversation.findMany({ where: { businessId }, orderBy: { updatedAt: "desc" }, take: 20, select: { id: true, title: true, updatedAt: true } }),
    questionsToday(businessId),
  ]);
  return { modes: assistantModes(permissions), conversations: rows.map(toConversation), usage: { used, limit: ASSISTANT_DAILY_QUESTIONS } };
}

export async function getAssistantThread(businessId: string, id: string): Promise<AssistantThreadDto> {
  const row = await db.assistantConversation.findFirst({
    where: { id, businessId },
    select: { id: true, title: true, updatedAt: true, messages: { orderBy: { createdAt: "asc" }, select: MESSAGE_SELECT } },
  });
  if (!row) throw notFound("Conversation");
  return { ...toConversation(row), messages: row.messages.map(toMessage) };
}

/** Deletes one chat of the business with all its messages (other businesses' chats are 404). */
export async function deleteAssistantConversation(businessId: string, id: string): Promise<void> {
  const { count } = await db.assistantConversation.deleteMany({ where: { id, businessId } });
  if (!count) throw notFound("Conversation");
}

// ─── Grounding data ──────────────────────────────────────────────────────────

/**
 * Everything an answer may use. Instagram sections are left out when there's no data to show.
 * Competitors are loaded for the competitors mode, and for "strategy" when `withCompetitors`
 * (the business has the competitors feature). Shared by the assistant and the recommendations.
 */
export async function gatherAssistantFacts(businessId: string, mode: FactsScope, { withCompetitors = false, permissions }: { withCompetitors?: boolean; permissions?: Permissions } = {}): Promise<AssistantFacts> {
  const business = await db.business.findUniqueOrThrow({
    where: { id: businessId },
    select: {
      name: true,
      nameAr: true,
      businessType: true,
      businessTypeOther: true,
      category: true,
      location: true,
      description: true,
      products: true,
      targetAudience: true,
      niche: true,
      aim: true,
      goals: true,
      timeline: true,
      exampleCaption: true,
      languages: true,
      timezone: true,
      brandVoice: { select: { toneLevel: true, brandWords: true, defaultHashtags: true, wordsToAvoid: true } },
      instagramConnection: { select: { provider: true, status: true, tokenExpiresAt: true, lastSyncAt: true, username: true } },
    },
  });
  const context = await currentBrandContext(businessId);
  const voice = business.brandVoice;
  const conn = business.instagramConnection;
  const account = await getInstagramAccount(businessId);

  const status: AssistantFacts["instagram"]["status"] =
    !conn || conn.status === "DISCONNECTED"
      ? "not_connected"
      : conn.provider === "META"
        ? needsReconnect(conn)
          ? "reconnect_needed"
          : "connected"
        : account.connected
          ? "demo"
          : "not_connected";

  const facts: AssistantFacts = {
    business: {
      name: business.name,
      nameAr: business.nameAr,
      type: business.businessType === "other" ? business.businessTypeOther : (business.businessType ?? business.category),
      location: business.location,
      description: business.description,
      products: business.products,
      targetAudience: business.targetAudience,
      focus: { niche: business.niche, aim: business.aim, goals: business.goals, timeline: business.timeline, exampleCaption: business.exampleCaption },
      languages: postingLanguages(business.languages),
      timezone: business.timezone,
    },
    brand: {
      summary: context?.summary ?? null,
      captionStyle: context ? `${context.captionStyle.summary}${context.captionStyle.traits.length ? ` (${context.captionStyle.traits.join("; ")})` : ""}` : null,
      postTypes: context?.purposePatterns.map((p) => `${p.label ?? p.purpose}: ${p.description}`) ?? [],
      toneLevel: context?.toneLevel ?? voice?.toneLevel ?? 50,
      wordsToUse: context?.wordsToUse ?? voice?.brandWords ?? [],
      wordsToAvoid: context?.wordsToAvoid ?? voice?.wordsToAvoid ?? [],
      hashtags: [...new Set([...(context?.captionStyle.hashtags ?? []), ...(voice?.defaultHashtags ?? [])])],
    },
    instagram: { status, username: conn?.username ?? (account.username || null), lastSyncAt: conn?.provider === "META" ? (conn.lastSyncAt?.toISOString() ?? null) : null },
  };

  if (status !== "not_connected") {
    try {
      const ig = getInstagramService();
      const [profile, insights, media] = await Promise.all([ig.getProfile(account), ig.getInsights(account), ig.getMedia(account, { limit: 20 })]);
      const metric = (m: { value: number; changePct: number; available?: boolean }) => ({ value: m.value, changePct: m.changePct, available: m.available !== false });
      facts.profile = { followers: profile.followers, following: profile.following, posts: profile.posts };
      facts.metrics = {
        reach: metric(insights.metrics.reach),
        engagementRate: metric(insights.metrics.engagementRate),
        followerGrowth: metric(insights.metrics.followerGrowth),
        profileVisits: metric(insights.metrics.profileVisits),
      };
      const series = insights.followerSeries;
      facts.followers = series.length >= 2 ? { first: { date: series[0].date, value: series[0].followers }, last: { date: series.at(-1)!.date, value: series.at(-1)!.followers }, days: series.length } : null;
      // getMedia puts the top post first; the assistant wants plain newest-first order.
      facts.posts = [...media]
        .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
        .map((m) => ({ postedAt: m.postedAt, type: m.mediaType, caption: m.caption, likes: m.likes, comments: m.comments, reach: m.reach, saves: m.saves }));
      const best = insights.opportunity && insights.windows.find((w) => w.id === insights.opportunity!.window);
      facts.windows = {
        baselineReach: insights.baselineReach,
        list: insights.windows.filter((w) => w.postsSampled > 0).map((w) => ({ startHour: w.startHour, endHour: w.endHour, postsSampled: w.postsSampled, avgReach: w.avgReach, vsBaselinePct: w.vsBaselinePct })),
        best: best && insights.opportunity ? { startHour: best.startHour, endHour: best.endHour, liftPct: insights.opportunity.liftPct, sampleSize: insights.opportunity.sampleSize, confidencePct: insights.opportunity.confidencePct } : null,
      };
    } catch (error) {
      // No numbers are better than wrong ones: answer from the brand data and say the Instagram data couldn't be read.
      console.error("[assistant] Instagram data unavailable", (error as Error).message);
      facts.instagram.status = "not_connected";
    }
  }

  if (mode === "competitors" || (mode === "strategy" && withCompetitors)) {
    try {
      facts.competitors = (await listCompetitors(businessId)).map((c) => ({
        handle: c.handle,
        name: c.displayName ?? c.name,
        followers: c.followers,
        engagementRate: c.engagementRate,
        followerChangePct: c.engagementHistory.length >= 2 ? c.followerChangePct : null,
        postsPerWeek: c.postsPerWeek,
        recentPosts: c.recentPosts.map((p) => ({ likes: p.likes, comments: p.comments })),
        lastFetchedAt: c.lastFetchedAt,
        note: c.note || c.notableNote || null,
      }));
    } catch (error) {
      console.error("[assistant] competitor data unavailable", (error as Error).message);
      facts.competitors = [];
    }
  }
  if (permissions && facts.instagram.status !== "not_connected") facts.analysis = await gatherAnalysis(businessId, mode, permissions);
  return facts;
}

/** The analysis pages' numbers for the chat (Analytics: content mix + methods; Competitors: competitor analysis). Never calls the AI. */
async function gatherAnalysis(businessId: string, mode: FactsScope, permissions: Permissions): Promise<AssistantFacts["analysis"]> {
  try {
    if (mode === "analytics") {
      const own = await ownPosts(businessId);
      const methods = isFeatureEnabled(permissions, "methods") ? await methodsOverview(businessId, permissions) : null;
      return { you: accountStats(own.posts, own.followers, own.timeZone), followers: own.followers, methods: methods && { ranking: methods.ranking, promoted: methods.promoted } };
    }
    if (mode === "competitors" && isFeatureEnabled(permissions, "competitors.analysis")) {
      const a = await competitorAnalysis(businessId);
      return {
        you: a.you.stats,
        followers: a.you.followers,
        competitors: a.competitors.map((c) => ({ handle: c.handle, followers: c.followers, stats: c.stats, growth: { changePct: c.growth.changePct, weeks: c.growth.weeks }, comparison: c.comparison, methods: c.methods, issue: c.issue })),
      };
    }
  } catch (error) {
    console.error("[assistant] analysis data unavailable", (error as Error).message);
  }
  return undefined;
}

// ─── Asking ──────────────────────────────────────────────────────────────────

export async function askAssistant(
  ctx: { businessId: string; userId: string; permissions: Permissions },
  input: { conversationId?: string; mode: AssistantMode; text: string },
): Promise<AssistantReplyDto> {
  const { businessId } = ctx;
  if (!assistantModes(ctx.permissions).includes(input.mode)) throw notFound("Assistant mode");
  const question = input.text.trim();

  const conversation = input.conversationId
    ? await db.assistantConversation.findFirst({ where: { id: input.conversationId, businessId }, select: { id: true } })
    : null;
  if (input.conversationId && !conversation) throw notFound("Conversation");

  if ((await questionsToday(businessId)) >= ASSISTANT_DAILY_QUESTIONS) {
    throw new ApiError(429, "assistant_limit", `The assistant answers up to ${ASSISTANT_DAILY_QUESTIONS} questions a day per business.`);
  }

  const previous = conversation
    ? (await db.assistantMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: "desc" }, take: ASSISTANT_HISTORY_TURNS, select: { role: true, content: true } })).reverse()
    : [];
  // A chat history sent to the model starts with a question.
  while (previous[0]?.role === "ASSISTANT") previous.shift();

  const business = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true, nameAr: true } });
  const language = questionLanguage(question);
  const facts = await gatherAssistantFacts(businessId, input.mode, { permissions: ctx.permissions });
  const answer = await getAIService().chat({
    businessId,
    prompt: {
      mode: input.mode,
      language,
      businessName: business.name,
      businessNameAr: business.nameAr,
      facts: formatFacts(facts, input.mode),
      history: previous.map((m) => ({ role: m.role === "USER" ? "user" : "assistant", text: m.content })),
      question,
    },
  });
  if (!answer.ok) {
    throw new ApiError(503, "assistant_unavailable", "The assistant can't answer right now.", [{ path: "reason", message: answer.reason }]);
  }

  const asked = new Date();
  const answered = new Date(asked.getTime() + 1);
  const mode = TO_DB[input.mode];
  const saved = await db.$transaction(async (tx) => {
    const chat = conversation
      ? await tx.assistantConversation.update({ where: { id: conversation.id }, data: { updatedAt: answered }, select: { id: true, title: true, updatedAt: true } })
      : await tx.assistantConversation.create({ data: { businessId, userId: ctx.userId, title: chatTitle(question) }, select: { id: true, title: true, updatedAt: true } });
    const q = await tx.assistantMessage.create({ data: { conversationId: chat.id, role: "USER", mode, content: question, language, createdAt: asked }, select: MESSAGE_SELECT });
    const a = await tx.assistantMessage.create({ data: { conversationId: chat.id, role: "ASSISTANT", mode, content: answer.text, language, createdAt: answered }, select: MESSAGE_SELECT });
    return { chat, q, a };
  });
  return { conversation: toConversation(saved.chat), messages: [toMessage(saved.q), toMessage(saved.a)] };
}
