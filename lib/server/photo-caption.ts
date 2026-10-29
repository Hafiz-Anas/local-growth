import "server-only";
import { db } from "@/lib/db";
import { locationLabel } from "@/config/kuwait";
import { computeGrowthSignals } from "@/lib/analysis/growth-signals";
import { suggestPostTime } from "@/lib/gallery/suggest-time";
import { getAIService } from "@/lib/services/ai";
import { getInstagramService } from "@/lib/services/instagram";
import { neutralCaption, type PhotoCaptionTone } from "@/lib/services/text/photo-caption";
import type { PhotoCaptionDto } from "@/types/api";
import { FOCUS_SELECT, toBusinessFocus } from "./business-focus";
import { resolvePhotos } from "./gallery";
import { fetchImage, toAnalysisJpeg } from "./image-fetch";
import { getInstagramAccount } from "./instagram-account";
import { ownPosts } from "./post-data";
import { getRateLimiter, PHOTO_CAPTION_LIMIT } from "./rate-limit";

/**
 * POST /api/gallery/caption — the caption on the AI chat's post card for the owner's own photos: the text
 * model looks at the photos (up to CAPTION_IMAGES, as small JPEGs) and the business's details and writes it
 * in English and Arabic with hashtags, through the text request gate and PHOTO_CAPTION_LIMIT. Answers with a
 * number or claim not in the business data are rejected (lib/services/text/photo-caption.ts). Whenever the
 * AI can't answer, the neutral template about the business is returned instead (never sample text). Also
 * suggests a time: the business's best posting slot, else tomorrow evening.
 */

const CAPTION_IMAGES = 3;

export async function photoCaption(businessId: string, input: { photoIds: string[]; tone: PhotoCaptionTone; request?: string }): Promise<PhotoCaptionDto> {
  const photos = await resolvePhotos(businessId, input.photoIds, { create: false });
  const business = await db.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { name: true, nameAr: true, timezone: true, brandVoice: { select: { defaultHashtags: true } }, ...FOCUS_SELECT },
  });
  const suggestedFor = (await suggestedTime(businessId, business.timezone || "Asia/Kuwait")).toISOString();
  const template = () => {
    const text = neutralCaption(
      {
        businessName: business.name,
        businessNameAr: business.nameAr,
        defaultHashtags: business.brandVoice?.defaultHashtags ?? [],
        area: locationLabel(business.governorate, business.area, "en") || null,
        areaAr: locationLabel(business.governorate, business.area, "ar") || null,
      },
      input.tone,
    );
    return { ...text, suggestedFor, source: "template" as const };
  };

  const ai = getAIService();
  if (!ai.textAvailability().available || !(await getRateLimiter().consume(PHOTO_CAPTION_LIMIT, businessId))) return template();

  const images = await loadImages(businessId, photos.slice(0, CAPTION_IMAGES));
  const answer = await ai.photoCaption({
    businessId,
    prompt: {
      businessName: business.name,
      businessNameAr: business.nameAr,
      focus: toBusinessFocus(business),
      images,
      title: photos[0].title,
      tone: input.tone,
      request: input.request?.trim() || null,
    },
  });
  return answer.ok ? { caption: answer.caption, hashtags: answer.hashtags, suggestedFor, source: "ai" } : template();
}

/** The photos as small JPEGs; Instagram links expire, so a current one is asked for first. Unreadable ones are skipped. */
async function loadImages(businessId: string, photos: Awaited<ReturnType<typeof resolvePhotos>>) {
  const account = photos.some((p) => p.igMediaId) ? await getInstagramAccount(businessId) : null;
  const ig = getInstagramService();
  const images: Array<{ mimeType: string; data: string }> = [];
  for (const photo of photos) {
    const url = photo.igMediaId ? (account?.connected ? await ig.getMediaImageUrl(account, photo.igMediaId).catch(() => null) : null) : photo.url;
    const raw = await fetchImage(url).catch(() => null);
    const jpeg = raw && (await toAnalysisJpeg(raw));
    if (jpeg) images.push({ mimeType: "image/jpeg", data: jpeg.toString("base64") });
  }
  return images;
}

/** The next time at the business's best posting slot from its own posts, else tomorrow evening. */
async function suggestedTime(businessId: string, timeZone: string): Promise<Date> {
  const own = await ownPosts(businessId).catch(() => null);
  const slot = own?.posts.length ? computeGrowthSignals(own.posts, { timeZone: own.timeZone }).bestSlot : null;
  return suggestPostTime(new Date(), own?.timeZone ?? timeZone, slot);
}
