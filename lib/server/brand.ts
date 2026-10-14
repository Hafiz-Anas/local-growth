import "server-only";
import { DEFAULT_INSTAGRAM_LANGUAGES } from "@/config/onboarding";
import { inferPostingLanguages } from "@/lib/brand-language";
import { db } from "@/lib/db";
import type { PostPurpose as DbPostPurpose, Prisma } from "@/lib/generated/prisma/client";
import { BrandContextError, getAIService, type BrandContextForCaptions } from "@/lib/services/ai";
import { getInstagramService } from "@/lib/services/instagram";
import type { CatalogProfile } from "@/lib/services/catalog";
import { getStorageService } from "@/lib/services/storage";
import { captionStyleSchema, purposePatternSchema, styleNotesSchema } from "@/lib/validation/api";
import type { BrandBasicsDto, BrandContextDto, BrandContextPatch, BrandPostDto, BrandProfileDto, InstagramLanguage, PostPurpose } from "@/types";
import { logActivity } from "./activity";
import { ApiError, notFound } from "./http";
import { getInstagramAccount } from "./instagram-account";

/**
 * Brand profile: the example posts a business picked, its brand basics, and
 * the versioned BrandContext the AI built from them. Shared by the onboarding
 * wizard, Settings → Brand profile, the Post Generator and the admin view.
 */

const lower = <T extends string>(value: T) => value.toLowerCase() as Lowercase<T>;
export const toDbPurpose = (purpose: PostPurpose) => purpose.toUpperCase() as DbPostPurpose;

// Posts ------------------------------------------------------------------------

export const BRAND_POST_SELECT = {
  id: true,
  source: true,
  igMediaId: true,
  mediaUrl: true,
  mediaType: true,
  caption: true,
  purpose: true,
  purposeOther: true,
  purposeNote: true,
  order: true,
} satisfies Prisma.BrandPostSelect;

export function toBrandPost(row: Prisma.BrandPostGetPayload<{ select: typeof BRAND_POST_SELECT }>): BrandPostDto {
  return { ...row, source: lower(row.source), mediaType: lower(row.mediaType), purpose: lower(row.purpose) };
}

export async function listBrandPosts(businessId: string): Promise<BrandPostDto[]> {
  const rows = await db.brandPost.findMany({ where: { businessId }, select: BRAND_POST_SELECT, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  return rows.map(toBrandPost);
}

export async function findOwnBrandPost(businessId: string, id: string) {
  const post = await db.brandPost.findFirst({ where: { id, businessId }, select: { id: true, mediaUrl: true, source: true } });
  if (!post) throw notFound("Post");
  return post;
}

/** Deletes an uploaded file once no avatar, logo, brand post or brand context points to it. */
export async function deleteUploadIfUnused(url: string | null | undefined) {
  if (!url) return;
  const storage = getStorageService();
  const key = storage.keyFromUrl(url);
  if (!key) return;
  const uses = await Promise.all([
    db.brandPost.count({ where: { mediaUrl: url } }),
    db.business.count({ where: { OR: [{ logoUrl: url }, { avatarUrl: url }] } }),
    db.brandContext.count({ where: { logoUrl: url } }),
    db.user.count({ where: { avatarUrl: url } }),
    db.postDraft.count({ where: { imageUrl: url } }),
    db.scheduledPost.count({ where: { mediaUrl: url } }),
  ]);
  if (uses.every((n) => n === 0)) await storage.delete(key);
}

// Basics -----------------------------------------------------------------------

export async function getBrandBasics(businessId: string): Promise<BrandBasicsDto> {
  const row = await db.business.findUnique({
    where: { id: businessId },
    select: { brandColors: true, logoUrl: true, languages: true, brandVoice: { select: { toneLevel: true, brandWords: true, wordsToAvoid: true } } },
  });
  if (!row) throw notFound("Business");
  return {
    colors: row.brandColors,
    languages: postingLanguages(row.languages),
    logoUrl: row.logoUrl,
    toneLevel: row.brandVoice?.toneLevel ?? 50,
    wordsToUse: row.brandVoice?.brandWords ?? [],
    wordsToAvoid: row.brandVoice?.wordsToAvoid ?? [],
  };
}

/** The saved posting languages ("ar"/"en"); both when nothing usable is stored. */
export function postingLanguages(stored: string[]): InstagramLanguage[] {
  const languages = stored.filter((l): l is InstagramLanguage => l === "ar" || l === "en");
  return languages.length ? languages : [...DEFAULT_INSTAGRAM_LANGUAGES];
}

/**
 * Onboarding no longer asks which language the brand posts in: it is learned
 * from the example posts' captions plus the connected account's recent posts.
 * Instagram being unreachable never blocks the build — the example posts suffice.
 */
/** Up to 12 recent captions of the connected account (none when not connected or unreadable). */
async function recentInstagramCaptions(businessId: string): Promise<string[]> {
  try {
    const account = await getInstagramAccount(businessId);
    if (!account.connected) return [];
    const media = await getInstagramService().getMedia(account, { limit: 12 });
    return media.map((m) => m.caption).filter((c) => c.trim());
  } catch {
    return [];
  }
}

async function learnPostingLanguages(businessId: string, captions: string[]): Promise<InstagramLanguage[] | null> {
  const all = [...captions];
  try {
    const account = await getInstagramAccount(businessId);
    if (account.connected) {
      const media = await getInstagramService().getMedia(account, { limit: 25 });
      all.push(...media.map((m) => m.caption));
    }
  } catch (error) {
    console.warn("[brand] couldn't read Instagram captions for the posting language", error);
  }
  return inferPostingLanguages(all);
}

/** Writes brand basics: colours/logo on Business, tone and words on BrandVoice (the Post Generator reads those). */
export async function saveBrandBasics(
  tx: Prisma.TransactionClient,
  businessId: string,
  basics: Partial<Pick<BrandBasicsDto, "colors" | "languages" | "toneLevel" | "wordsToUse" | "wordsToAvoid">>,
) {
  if (basics.colors || basics.languages) {
    await tx.business.update({ where: { id: businessId }, data: { ...(basics.colors && { brandColors: basics.colors }), ...(basics.languages && { languages: basics.languages }) } });
  }
  const voice = {
    ...(basics.toneLevel !== undefined && { toneLevel: basics.toneLevel }),
    ...(basics.wordsToUse && { brandWords: basics.wordsToUse }),
    ...(basics.wordsToAvoid && { wordsToAvoid: basics.wordsToAvoid }),
  };
  if (Object.keys(voice).length) {
    await tx.brandVoice.upsert({ where: { businessId }, update: voice, create: { businessId, defaultHashtags: [], brandWords: [], wordsToAvoid: [], ...voice } });
  }
}

// Brand context ----------------------------------------------------------------

export const BRAND_CONTEXT_SELECT = {
  id: true,
  version: true,
  status: true,
  summary: true,
  visualStyle: true,
  captionStyle: true,
  purposePatterns: true,
  colors: true,
  logoUrl: true,
  toneLevel: true,
  wordsToUse: true,
  wordsToAvoid: true,
  editedByUser: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BrandContextSelect;

const EMPTY_STYLE = styleNotesSchema.parse({});
const EMPTY_CAPTION_STYLE = captionStyleSchema.parse({});

export function toBrandContext(row: Prisma.BrandContextGetPayload<{ select: typeof BRAND_CONTEXT_SELECT }>): BrandContextDto {
  return {
    id: row.id,
    version: row.version,
    status: lower(row.status),
    summary: row.summary,
    // Stored JSON is parsed defensively so an old or hand-edited row can't break the UI.
    visualStyle: styleNotesSchema.catch(EMPTY_STYLE).parse(row.visualStyle),
    captionStyle: captionStyleSchema.catch(EMPTY_CAPTION_STYLE).parse(row.captionStyle),
    purposePatterns: purposePatternSchema.array().catch([]).parse(row.purposePatterns),
    colors: row.colors,
    logoUrl: row.logoUrl,
    toneLevel: row.toneLevel,
    wordsToUse: row.wordsToUse,
    wordsToAvoid: row.wordsToAvoid,
    editedByUser: row.editedByUser,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The newest version that finished building. */
export async function currentBrandContext(businessId: string): Promise<BrandContextDto | null> {
  const row = await db.brandContext.findFirst({ where: { businessId, status: "READY" }, select: BRAND_CONTEXT_SELECT, orderBy: { version: "desc" } });
  return row ? toBrandContext(row) : null;
}

/** For the AI: the current brand context, trimmed to what steers captions. */
export async function brandContextForCaptions(businessId: string): Promise<BrandContextForCaptions | null> {
  const context = await currentBrandContext(businessId);
  if (!context) return null;
  const { summary, captionStyle, purposePatterns, wordsToUse, wordsToAvoid } = context;
  return { summary, captionStyle, purposePatterns, wordsToUse, wordsToAvoid };
}

export async function getBrandProfile(businessId: string): Promise<BrandProfileDto> {
  const [context, versions, posts, basics] = await Promise.all([
    currentBrandContext(businessId),
    db.brandContext.findMany({ where: { businessId }, select: { version: true, status: true, editedByUser: true, createdAt: true }, orderBy: { version: "desc" }, take: 20 }),
    listBrandPosts(businessId),
    getBrandBasics(businessId),
  ]);
  return {
    context,
    versions: versions.map((v) => ({ version: v.version, status: lower(v.status), editedByUser: v.editedByUser, createdAt: v.createdAt.toISOString() })),
    posts,
    basics,
  };
}

/** Products and post purposes (most used first) for the Post Generator's catalogue. */
export async function catalogProfile(businessId: string): Promise<CatalogProfile> {
  const [business, purposes] = await Promise.all([
    db.business.findUnique({ where: { id: businessId }, select: { products: true } }),
    db.brandPost.groupBy({ by: ["purpose"], where: { businessId }, _count: { _all: true } }),
  ]);
  return {
    products: business?.products ?? [],
    purposes: purposes.sort((a, b) => b._count._all - a._count._all).map((p) => lower(p.purpose)),
  };
}

/**
 * Builds a new BrandContext version from everything the business entered.
 * The row is created as BUILDING, then READY with the AI's answer — or FAILED,
 * in which case an ApiError is thrown (callers record it as an onboarding error).
 */
export async function buildBrandContext(businessId: string, actorId: string): Promise<BrandContextDto> {
  const business = await db.business.findUnique({
    where: { id: businessId },
    select: {
      name: true,
      businessType: true,
      businessTypeOther: true,
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
      onboardingStatus: true,
      brandColors: true,
      logoUrl: true,
      brandVoice: { select: { toneLevel: true, brandWords: true, wordsToAvoid: true } },
      brandPosts: { select: { purpose: true, purposeOther: true, purposeNote: true, caption: true, mediaType: true }, orderBy: { order: "asc" } },
      competitors: { where: { validationStatus: "READY" }, select: { handle: true } },
    },
  });
  if (!business) throw notFound("Business");
  // Example posts are optional (onboarding no longer asks for them): the profile is then built from the
  // business details and the account's recent captions.
  const recentCaptions = business.brandPosts.length ? [] : await recentInstagramCaptions(businessId);

  // During onboarding the language is learned from the captions and saved; afterwards
  // the saved value is used, since it can be changed in Settings → Brand profile.
  let languages = postingLanguages(business.languages);
  if (business.onboardingStatus === "IN_PROGRESS") {
    const learned = await learnPostingLanguages(businessId, business.brandPosts.map((p) => p.caption));
    if (learned) {
      languages = learned;
      await db.business.update({ where: { id: businessId }, data: { languages } });
    }
  }

  const latest = await db.brandContext.findFirst({ where: { businessId }, select: { version: true }, orderBy: { version: "desc" } });
  const voice = business.brandVoice ?? { toneLevel: 50, brandWords: [], wordsToAvoid: [] };
  const created = await db.brandContext.create({
    data: {
      businessId,
      version: (latest?.version ?? 0) + 1,
      status: "BUILDING",
      colors: business.brandColors,
      logoUrl: business.logoUrl,
      toneLevel: voice.toneLevel,
      wordsToUse: voice.brandWords,
      wordsToAvoid: voice.wordsToAvoid,
    },
    select: { id: true, version: true },
  });

  try {
    const draft = await getAIService().buildBrandContext({
      businessId,
      businessName: business.name,
      businessType: business.businessType,
      businessTypeOther: business.businessTypeOther,
      location: business.location,
      description: business.description,
      products: business.products,
      targetAudience: business.targetAudience,
      languages,
      posts: business.brandPosts.map((p) => ({ ...p, purpose: lower(p.purpose), mediaType: lower(p.mediaType) })),
      colors: business.brandColors,
      hasLogo: Boolean(business.logoUrl),
      toneLevel: voice.toneLevel,
      wordsToUse: voice.brandWords,
      wordsToAvoid: voice.wordsToAvoid,
      competitorHandles: business.competitors.map((c) => c.handle),
      focus: { niche: business.niche, aim: business.aim, goals: business.goals, timeline: business.timeline, exampleCaption: business.exampleCaption },
      recentCaptions,
    });
    const row = await db.brandContext.update({
      where: { id: created.id },
      data: { status: "READY", summary: draft.summary, visualStyle: { ...draft.visualStyle }, captionStyle: { ...draft.captionStyle }, purposePatterns: draft.purposePatterns.map((p) => ({ ...p })) },
      select: BRAND_CONTEXT_SELECT,
    });
    await logActivity({ businessId, userId: actorId, action: "brand_context.built", details: { version: row.version } });
    return toBrandContext(row);
  } catch (error) {
    await db.brandContext.update({ where: { id: created.id }, data: { status: "FAILED" } });
    console.error("[brand] buildBrandContext failed", error);
    throw new ApiError(502, "ai_error", error instanceof BrandContextError ? error.message : "The AI couldn't build the brand profile.", { version: created.version });
  }
}

/**
 * Edits the current brand context in place (marked as edited by the user) and
 * keeps the brand basics in step, so the Post Generator and settings agree.
 */
export async function updateBrandContext(businessId: string, patch: BrandContextPatch, actorId: string): Promise<BrandContextDto> {
  const current = await db.brandContext.findFirst({ where: { businessId, status: "READY" }, select: { id: true }, orderBy: { version: "desc" } });
  if (!current) throw notFound("Brand profile");
  const row = await db.$transaction(async (tx) => {
    const updated = await tx.brandContext.update({
      where: { id: current.id },
      data: {
        ...(patch.summary !== undefined && { summary: patch.summary }),
        ...(patch.visualStyle && { visualStyle: { ...patch.visualStyle } }),
        ...(patch.captionStyle && { captionStyle: { ...patch.captionStyle } }),
        ...(patch.purposePatterns && { purposePatterns: patch.purposePatterns.map((p) => ({ ...p })) }),
        ...(patch.colors && { colors: patch.colors }),
        ...(patch.toneLevel !== undefined && { toneLevel: patch.toneLevel }),
        ...(patch.wordsToUse && { wordsToUse: patch.wordsToUse }),
        ...(patch.wordsToAvoid && { wordsToAvoid: patch.wordsToAvoid }),
        editedByUser: true,
      },
      select: BRAND_CONTEXT_SELECT,
    });
    await saveBrandBasics(tx, businessId, patch);
    await logActivity({ businessId, userId: actorId, action: "brand_context.edited", details: { version: updated.version, fields: Object.keys(patch) } }, tx);
    return updated;
  });
  return toBrandContext(row);
}
