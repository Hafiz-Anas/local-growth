import "server-only";
import { after } from "next/server";
import { STYLE_PHOTO_MAX } from "@/config/onboarding";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { getAIService } from "@/lib/services/ai";
import { getInstagramService } from "@/lib/services/instagram";
import { getStorageService } from "@/lib/services/storage";
import { STYLE_SUMMARY_MAX } from "@/lib/services/text/style";
import type { StyleGuideDto, StylePhoto } from "@/types";
import { aiPace } from "./ai-pace";
import { ApiError } from "./http";
import { fetchImage, toAnalysisJpeg } from "./image-fetch";
import { getInstagramAccount } from "./instagram-account";
import { getRateLimiter, STYLE_GUIDE_LIMIT } from "./rate-limit";

/**
 * Onboarding's "Your style": the owner picks up to 5 of their best posts and/or uploads photos; in the
 * background the Gemini text model reads them and we keep a text style guide per business (palette,
 * angle, lighting, closeness, background and props, mood) plus one line the owner sees and can edit.
 * Skipped → the most recent posts are used later (at the end of onboarding, or by the daily job).
 * Instagram images are downloaded at the time of the analysis (their links expire) and never stored;
 * the analysis goes through the AI's request gate and STYLE_GUIDE_LIMIT.
 */

/** Uploaded style photos live under this storage prefix. */
export const STYLE_UPLOAD_PREFIX = "style";
/** Longest side sent to the model: plenty to judge the style, few tokens. */
/** Recent posts looked at when none were picked. */
const RECENT_POSTS = 12;
/** Businesses analysed per daily run (finished onboarding, connected, no guide yet). */
export const STYLE_GUIDE_CRON_BATCH = 5;

const STYLE_SELECT = {
  status: true,
  summary: true,
  summaryEditedAt: true,
  basis: true,
  photos: true,
  failureReason: true,
  updatedAt: true,
} satisfies Prisma.StyleGuideSelect;

export function readPhotos(stored: Prisma.JsonValue | null | undefined): StylePhoto[] {
  if (!Array.isArray(stored)) return [];
  return stored
    .map((p) => p as Record<string, unknown> | null)
    .flatMap((p): StylePhoto[] =>
      p?.source === "instagram" && typeof p.igMediaId === "string"
        ? [{ source: "instagram", igMediaId: p.igMediaId }]
        : p?.source === "upload" && typeof p.url === "string"
          ? [{ source: "upload", url: p.url }]
          : [],
    )
    .slice(0, STYLE_PHOTO_MAX);
}

function toDto(row: Prisma.StyleGuideGetPayload<{ select: typeof STYLE_SELECT }>): StyleGuideDto {
  return {
    status: row.status.toLowerCase() as StyleGuideDto["status"],
    summary: row.summary,
    edited: Boolean(row.summaryEditedAt),
    basis: (row.basis as StyleGuideDto["basis"]) ?? null,
    photos: readPhotos(row.photos),
    failureReason: row.failureReason,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getStyleGuide(businessId: string): Promise<StyleGuideDto | null> {
  const row = await db.styleGuide.findUnique({ where: { businessId }, select: STYLE_SELECT });
  return row ? toDto(row) : null;
}

/** Our own uploaded style photo (never someone else's URL). */
function uploadKey(url: string): string | null {
  const key = getStorageService().keyFromUrl(url);
  return key?.startsWith(`${STYLE_UPLOAD_PREFIX}/`) ? key : null;
}

/**
 * Saves the owner's picks and starts the analysis after the response (onboarding never waits).
 * An empty list means "use my recent posts". New photos replace the old line, even one they edited.
 */
export async function saveStylePhotos(businessId: string, photos: StylePhoto[]): Promise<StyleGuideDto> {
  const unique = [...new Map(photos.map((p) => [p.source === "instagram" ? `ig:${p.igMediaId}` : `up:${p.url}`, p])).values()];
  if (unique.length > STYLE_PHOTO_MAX) throw new ApiError(400, "validation_error", `Pick up to ${STYLE_PHOTO_MAX} photos.`, [{ path: "photos", message: "too_many" }]);
  if (unique.some((p) => p.source === "upload" && !uploadKey(p.url))) throw new ApiError(400, "validation_error", "Upload the photo first.", [{ path: "photos", message: "unknown_upload" }]);

  const previous = readPhotos((await db.styleGuide.findUnique({ where: { businessId }, select: { photos: true } }))?.photos);
  const kept = new Set(unique.flatMap((p) => (p.source === "upload" ? [p.url] : [])));
  const removed = previous.flatMap((p) => (p.source === "upload" && !kept.has(p.url) ? [uploadKey(p.url)] : [])).filter((k): k is string => Boolean(k));

  const data = { photos: unique as unknown as Prisma.InputJsonArray, status: "BUILDING" as const, basis: unique.length ? "picked" : "recent", failureReason: null, summaryEditedAt: null };
  const row = await db.styleGuide.upsert({ where: { businessId }, update: data, create: { businessId, ...data }, select: STYLE_SELECT });
  after(async () => {
    await Promise.all(removed.map((key) => getStorageService().delete(key).catch(() => undefined)));
    await buildStyleGuide(businessId).catch((e) => console.error("[style-guide] build failed", (e as Error).message));
  });
  return toDto(row);
}

/** The owner's own line ("Warm colors, close-up, top-down angle"); kept over the AI's from now on. */
export async function updateStyleSummary(businessId: string, summary: string): Promise<StyleGuideDto> {
  const text = summary.replace(/\s+/g, " ").trim().slice(0, STYLE_SUMMARY_MAX) || null;
  const row = await db.styleGuide.upsert({
    where: { businessId },
    update: { summary: text, summaryEditedAt: text ? new Date() : null },
    // No analysis yet (or none possible): the owner's line is the guide.
    create: { businessId, summary: text, summaryEditedAt: text ? new Date() : null, status: "READY", basis: "owner" },
    select: STYLE_SELECT,
  });
  return toDto(row);
}

/**
 * Makes sure there is a guide: without one (onboarding skipped "Your style"), the most recent posts
 * are read after the response. Never throws.
 */
export async function ensureStyleGuide(businessId: string) {
  try {
    if (await db.styleGuide.count({ where: { businessId } })) return;
    const account = await getInstagramAccount(businessId);
    if (!account.connected) return;
    await db.styleGuide.create({ data: { businessId, basis: "recent" } });
    after(() => buildStyleGuide(businessId).catch((e) => console.error("[style-guide] build failed", (e as Error).message)));
  } catch (error) {
    console.error("[style-guide] couldn't start", (error as Error).message);
  }
}

/** Reads the photos and asks the AI; the row ends READY (with the guide) or FAILED (with the reason). */
export async function buildStyleGuide(businessId: string): Promise<StyleGuideDto | null> {
  const row = await db.styleGuide.findUnique({ where: { businessId }, select: { photos: true } });
  if (!row) return null;
  // Results only land if the owner didn't pick other photos meanwhile (that run reports its own).
  const samePhotos = { businessId, photos: { equals: row.photos ?? [] } };
  const fail = async (reason: string) => {
    await db.styleGuide.updateMany({ where: samePhotos, data: { status: "FAILED", failureReason: reason } });
    return getStyleGuide(businessId);
  };
  if (!(await getRateLimiter().consume(STYLE_GUIDE_LIMIT, businessId))) return fail("rate_limited");

  const photos = readPhotos(row.photos);
  const images = await loadImages(businessId, photos);
  if (images.length === 0) return fail("no_images");

  const business = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true, businessType: true, businessTypeOther: true } });
  const answer = await getAIService().styleGuide({
    businessId,
    prompt: { businessName: business.name, businessType: business.businessType === "other" ? business.businessTypeOther : business.businessType, images },
  });
  if (!answer.ok) return fail(answer.reason);

  const g = answer.guide;
  const current = await db.styleGuide.findUnique({ where: { businessId }, select: { summaryEditedAt: true } });
  const updated = await db.styleGuide.updateMany({
    where: samePhotos,
    data: {
      status: "READY",
      basis: photos.length ? "picked" : "recent",
      palette: g.palette,
      angle: g.angle,
      lighting: g.lighting,
      closeness: g.closeness,
      background: g.background,
      mood: g.mood,
      // The owner's own line wins.
      ...(!current?.summaryEditedAt && { summary: g.summary }),
      failureReason: null,
      analyzedAt: new Date(),
    },
  });
  if (updated.count === 0) console.info("[style-guide] photos changed during the analysis; the newer run wins");
  return getStyleGuide(businessId);
}

/** Up to 5 images as small JPEGs (base64): the picks, or the most recent image posts. Unreadable ones are skipped. */
async function loadImages(businessId: string, photos: StylePhoto[]): Promise<Array<{ mimeType: string; data: string }>> {
  const sources: Array<() => Promise<Buffer | null>> = [];
  const account = await getInstagramAccount(businessId);
  const ig = getInstagramService();
  // Instagram links expire: ask for a current one now, then download it.
  const fromInstagram = (id: string) => async () => (account.connected ? fetchImage(await ig.getMediaImageUrl(account, id).catch(() => null)) : null);

  if (photos.length) {
    for (const p of photos) sources.push(p.source === "instagram" ? fromInstagram(p.igMediaId) : () => fetchImage(p.url));
  } else if (account.connected) {
    const media = await ig.getMedia(account, { limit: RECENT_POSTS }).catch(() => []);
    const recent = [...media].sort((a, b) => b.postedAt.localeCompare(a.postedAt)).filter((m) => m.mediaUrl);
    for (const m of recent) sources.push(fromInstagram(m.id));
  }

  const images: Array<{ mimeType: string; data: string }> = [];
  for (const load of sources) {
    if (images.length >= STYLE_PHOTO_MAX) break;
    const raw = await load().catch(() => null);
    const jpeg = raw && (await toAnalysisJpeg(raw));
    if (jpeg) images.push({ mimeType: "image/jpeg", data: jpeg.toString("base64") });
  }
  return images;
}

/**
 * Daily job: businesses that finished onboarding with Instagram connected but have no style guide
 * yet (they skipped the step, or finished before it existed) get one from their recent posts.
 */
export async function runStyleGuideSweep(budgetMs: number): Promise<{ analysed: number }> {
  const started = Date.now();
  const due = await db.business.findMany({
    where: { onboardingStatus: "COMPLETED", styleGuide: null, instagramConnection: { status: "CONNECTED" } },
    select: { id: true },
    take: STYLE_GUIDE_CRON_BATCH,
  });
  let analysed = 0;
  for (const { id } of due) {
    if (Date.now() - started > budgetMs) break;
    await aiPace();
    await db.styleGuide.create({ data: { businessId: id, basis: "recent" } }).catch(() => undefined);
    const result = await buildStyleGuide(id).catch(() => null);
    if (result?.status === "ready") analysed++;
  }
  return { analysed };
}
