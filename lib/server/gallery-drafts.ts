import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { mergeVersions, parseVersions, primaryCaption, withVersion } from "@/lib/gallery/drafts";
import type { CaptionVersionDto, GalleryDraftDto } from "@/types/api";
import { logActivity } from "./activity";
import { GALLERY_DRAFT_SELECT, GALLERY_DRAFT_WHERE, resolvePhotos, toDraftDto } from "./gallery";
import { notFound } from "./http";

/**
 * Gallery / AI chat drafts (BE2) on the existing PostDraft table (origin AI_CHAT or GALLERY), so the
 * publishing pipeline (ScheduledPost → lib/server/publishing.ts) can take them over in the next phase.
 * A draft keeps its photos in order (PostDraftPhoto; the first is the cover, also in imageUrl when it's
 * our own file), the caption in English and Arabic as posted (text + hashtags), the hashtags, the AI's
 * suggested time and the earlier captions Regenerate replaced. Nothing is published or scheduled here.
 */

type Both = { en: string; ar: string };

const asJson = (versions: CaptionVersionDto[]) => versions as unknown as Prisma.InputJsonArray;

export interface DraftInput {
  photoIds: string[];
  caption: Both;
  hashtags: string[];
  suggestedFor?: Date | null;
  versions?: CaptionVersionDto[];
  origin: "ai_chat" | "gallery";
}

export async function createDraft(businessId: string, userId: string, input: DraftInput): Promise<GalleryDraftDto> {
  const photos = await resolvePhotos(businessId, input.photoIds);
  const cover = photos[0];
  const own = cover.source === "UPLOADED" || cover.source === "AI_GENERATED";
  const draft = await db.postDraft.create({
    data: {
      businessId,
      createdBy: userId,
      origin: input.origin === "gallery" ? "GALLERY" : "AI_CHAT",
      ...primaryCaption(input.caption),
      captionEn: input.caption.en,
      captionAr: input.caption.ar,
      hashtags: input.hashtags,
      suggestedFor: input.suggestedFor ?? null,
      captionVersions: asJson(mergeVersions([], input.versions ?? [])),
      // Our own file only: Instagram links expire and sample images aren't ours to publish.
      imageUrl: own && cover.url && !cover.url.startsWith("/photos/") ? cover.url : null,
      imageSource: own ? (cover.source === "AI_GENERATED" ? "GENERATED" : "UPLOADED") : null,
      photos: { create: photos.map((p, position) => ({ photoId: p.rowId, position })) },
    },
    select: GALLERY_DRAFT_SELECT,
  });
  await logActivity({ businessId, userId, action: "gallery.draft_saved", details: { draftId: draft.id, origin: input.origin, photos: photos.length } });
  return toDraftDto(draft);
}

/** Edits a draft's caption, hashtags or suggested time. A caption from Regenerate keeps the one it replaces as a version. */
export async function updateDraft(
  businessId: string,
  id: string,
  patch: { caption?: Both; hashtags?: string[]; suggestedFor?: Date | null; regenerated?: boolean },
): Promise<GalleryDraftDto> {
  const draft = await db.postDraft.findFirst({ where: { id, businessId, ...GALLERY_DRAFT_WHERE }, select: { captionEn: true, captionAr: true, captionVersions: true } });
  if (!draft) throw notFound("Draft");
  const previous = { en: draft.captionEn ?? "", ar: draft.captionAr ?? "" };
  const versions = patch.caption && patch.regenerated ? withVersion(parseVersions(draft.captionVersions), previous, patch.caption, new Date().toISOString()) : undefined;
  const updated = await db.postDraft.update({
    where: { id },
    data: {
      ...(patch.caption && { ...primaryCaption(patch.caption), captionEn: patch.caption.en, captionAr: patch.caption.ar }),
      ...(patch.hashtags && { hashtags: patch.hashtags }),
      ...(patch.suggestedFor !== undefined && { suggestedFor: patch.suggestedFor }),
      ...(versions && { captionVersions: asJson(versions) }),
    },
    select: GALLERY_DRAFT_SELECT,
  });
  return toDraftDto(updated);
}

/** Deletes a draft (its photos stay in the Gallery). */
export async function deleteDraft(businessId: string, id: string) {
  const { count } = await db.postDraft.deleteMany({ where: { id, businessId, ...GALLERY_DRAFT_WHERE } });
  if (!count) throw notFound("Draft");
}
