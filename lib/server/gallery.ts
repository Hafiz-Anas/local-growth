import "server-only";
import { db } from "@/lib/db";
import type { GalleryPhotoSource, Prisma } from "@/lib/generated/prisma/client";
import { formatOf } from "@/lib/analysis/posts";
import { parseVersions } from "@/lib/gallery/drafts";
import { igPhotoId, parsePhotoRef, samplePhotoId } from "@/lib/gallery/refs";
import { GALLERY_MAX_ALBUMS, GALLERY_REMOVE_GRACE_MS } from "@/lib/gallery/uploads";
import type { GalleryAlbumDto, GalleryDraftDto, GalleryDto, GalleryPhotoDto } from "@/types/api";
import { ApiError, notFound } from "./http";

/**
 * The Gallery, stored per business (BE1). What the owner sees:
 *  - their own photos (GalleryPhoto UPLOADED / AI_GENERATED, files in StorageService);
 *  - their Instagram posts from the media sync (InstagramMedia) — real businesses only;
 *  - demo businesses (mock Instagram connection) also get the sample photos, which the screens add from
 *    the sample data and mark "Sample"; nothing sample is ever shown to a real business.
 * Favourites, albums, removing and drafts on an Instagram or sample photo are kept on a GalleryPhoto row
 * that only references it (created on first use). Every lookup is scoped to the business from the session:
 * another business's ids are 404.
 */

const PHOTO_SELECT = {
  id: true,
  source: true,
  url: true,
  thumbUrl: true,
  title: true,
  igMediaId: true,
  sampleKey: true,
  favorite: true,
  removedAt: true,
  createdAt: true,
  albums: { select: { albumId: true } },
} satisfies Prisma.GalleryPhotoSelect;

type PhotoRow = Prisma.GalleryPhotoGetPayload<{ select: typeof PHOTO_SELECT }>;

export const GALLERY_DRAFT_SELECT = {
  id: true,
  origin: true,
  captionEn: true,
  captionAr: true,
  hashtags: true,
  suggestedFor: true,
  captionVersions: true,
  updatedAt: true,
  photos: { orderBy: { position: "asc" }, select: { photo: { select: { id: true, igMediaId: true, sampleKey: true } } } },
} satisfies Prisma.PostDraftSelect;

type DraftRow = Prisma.PostDraftGetPayload<{ select: typeof GALLERY_DRAFT_SELECT }>;

/** Drafts the Gallery shows (not the old Post Generator's). */
export const GALLERY_DRAFT_WHERE = { origin: { in: ["AI_CHAT", "GALLERY"] }, status: "DRAFT" } satisfies Prisma.PostDraftWhereInput;

const OWN_SOURCES: GalleryPhotoSource[] = ["UPLOADED", "AI_GENERATED"];

/** The id the screens use for a row: Instagram and sample photos keep their reference id. */
export const photoDtoId = (row: { id: string; igMediaId: string | null; sampleKey: string | null }) =>
  row.sampleKey ? samplePhotoId(row.sampleKey) : row.igMediaId ? igPhotoId(row.igMediaId) : row.id;

/** A demo business: its Instagram connection is the mock one (the seeded demo logins). */
export async function isDemoBusiness(businessId: string): Promise<boolean> {
  const connection = await db.instagramConnection.findUnique({ where: { businessId }, select: { provider: true } });
  return connection?.provider === "MOCK";
}

export function toDraftDto(row: DraftRow): GalleryDraftDto {
  return {
    id: row.id,
    photoIds: row.photos.map((p) => photoDtoId(p.photo)),
    captionEn: row.captionEn ?? "",
    captionAr: row.captionAr ?? "",
    hashtags: row.hashtags,
    suggestedFor: row.suggestedFor?.toISOString() ?? null,
    versions: parseVersions(row.captionVersions),
    origin: row.origin === "GALLERY" ? "gallery" : "ai_chat",
    updatedAt: row.updatedAt.toISOString(),
  };
}

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** Everything the Gallery shows for the business (GET /api/gallery and the admin preview). */
export async function getGallery(businessId: string): Promise<GalleryDto> {
  const demo = await isDemoBusiness(businessId);
  const [rows, albums, drafts, media] = await Promise.all([
    db.galleryPhoto.findMany({ where: { businessId, status: "READY" }, orderBy: { createdAt: "desc" }, select: PHOTO_SELECT }),
    db.galleryAlbum.findMany({ where: { businessId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true, name: true } }),
    db.postDraft.findMany({ where: { businessId, ...GALLERY_DRAFT_WHERE }, orderBy: { updatedAt: "desc" }, take: 300, select: GALLERY_DRAFT_SELECT }),
    // Demo businesses' "Instagram" posts are the sample published photos; their mock media are placeholders.
    demo
      ? Promise.resolve([])
      : db.instagramMedia.findMany({
          where: { businessId },
          orderBy: { postedAt: "desc" },
          take: 300,
          select: { igMediaId: true, caption: true, mediaType: true, mediaProductType: true, mediaUrl: true, thumbnailUrl: true, permalink: true, postedAt: true, likeCount: true, commentsCount: true, insights: true },
        }),
  ]);

  const draftDtos = drafts.map(toDraftDto);
  // The newest draft each photo is in (drafts are newest first).
  const draftOf = new Map<string, string>();
  for (const d of draftDtos) for (const id of d.photoIds) if (!draftOf.has(id)) draftOf.set(id, d.id);

  const base = (row: PhotoRow | undefined, id: string) => ({
    id,
    favorite: row?.favorite ?? false,
    albumIds: row?.albums.map((a) => a.albumId) ?? [],
    draftId: draftOf.get(id) ?? null,
  });

  const photos: GalleryPhotoDto[] = [];
  const hidden: string[] = [];
  const refByIg = new Map<string, PhotoRow>();
  for (const row of rows) {
    const id = photoDtoId(row);
    if (row.removedAt) {
      // Own photos removed are gone from the list (Undo restores them); Instagram / sample ones stay hidden.
      if (row.igMediaId || row.sampleKey) hidden.push(id);
      continue;
    }
    if (row.igMediaId) {
      refByIg.set(row.igMediaId, row);
      continue;
    }
    if (row.sampleKey && !demo) continue;
    photos.push({
      ...base(row, id),
      // Sample photos take their source (upload / Instagram) from the sample data on screen.
      source: row.source === "AI_GENERATED" ? "ai" : "upload",
      sample: !!row.sampleKey,
      url: row.url,
      thumbUrl: row.thumbUrl,
      title: row.title,
      createdAt: row.createdAt.toISOString(),
    });
  }
  // Removed Instagram posts are in `hidden` (their rows were skipped above).
  const hiddenIg = new Set(rows.filter((r) => r.igMediaId && r.removedAt).map((r) => r.igMediaId!));
  for (const m of media) {
    if (hiddenIg.has(m.igMediaId)) continue;
    const format = formatOf(m.mediaType, m.mediaProductType);
    const url = format === "reel" || format === "video" ? (m.thumbnailUrl ?? m.mediaUrl) : (m.mediaUrl ?? m.thumbnailUrl);
    if (!url) continue;
    const insights = (m.insights ?? {}) as Record<string, unknown>;
    const id = igPhotoId(m.igMediaId);
    photos.push({
      ...base(refByIg.get(m.igMediaId), id),
      source: "instagram",
      sample: false,
      url,
      thumbUrl: url,
      title: null,
      createdAt: m.postedAt.toISOString(),
      instagram: {
        caption: m.caption,
        postedAt: m.postedAt.toISOString(),
        permalink: m.permalink,
        format: format === "video" ? "reel" : format,
        likes: m.likeCount,
        comments: m.commentsCount,
        reach: num(insights.reach),
        saves: num(insights.saved),
        shares: num(insights.shares),
      },
    });
  }
  photos.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return { demo, photos, albums: albums satisfies GalleryAlbumDto[], drafts: draftDtos, hidden };
}

export interface ResolvedPhoto {
  /** "" with `create: false` for an Instagram or sample photo that has no row yet. */
  rowId: string;
  dtoId: string;
  source: GalleryPhotoSource;
  /** Our stored file (own photos), a sample image path, or null (Instagram: ask for a current link). */
  url: string | null;
  igMediaId: string | null;
  title: string | null;
}

/**
 * The business's GalleryPhoto rows behind screen ids, in order, creating the reference rows of Instagram
 * and sample photos on first use. Unknown ids, ids of other businesses, sample ids of a real business and
 * Instagram ids of posts the business doesn't have are all 404. `removed`: also own photos removed within
 * the Undo window (for restoring). `create: false` checks the ids without creating reference rows.
 */
export async function resolvePhotos(
  businessId: string,
  ids: string[],
  { removed = false, create = true }: { removed?: boolean; create?: boolean } = {},
): Promise<ResolvedPhoto[]> {
  const unique = [...new Set(ids)];
  const refs = unique.map((id) => ({ id, ref: parsePhotoRef(id) }));
  if (refs.some((r) => !r.ref)) throw notFound("Photo");
  let demo: boolean | undefined;
  const out: ResolvedPhoto[] = [];
  for (const { id, ref } of refs) {
    if (ref!.kind === "own") {
      const row = await db.galleryPhoto.findFirst({
        where: {
          id: ref!.id,
          businessId,
          status: "READY",
          source: { in: OWN_SOURCES },
          sampleKey: null,
          ...(removed ? { OR: [{ removedAt: null }, { removedAt: { gt: new Date(Date.now() - GALLERY_REMOVE_GRACE_MS) } }] } : { removedAt: null }),
        },
        select: { id: true, source: true, url: true, title: true },
      });
      if (!row) throw notFound("Photo");
      out.push({ rowId: row.id, dtoId: id, source: row.source, url: row.url, igMediaId: null, title: row.title });
      continue;
    }
    demo ??= await isDemoBusiness(businessId);
    if (ref!.kind === "instagram") {
      if (demo) throw notFound("Photo");
      const media = await db.instagramMedia.findUnique({ where: { businessId_igMediaId: { businessId, igMediaId: ref!.igMediaId } }, select: { igMediaId: true } });
      if (!media) throw notFound("Photo");
      const row = create
        ? await db.galleryPhoto.upsert({
            where: { businessId_igMediaId: { businessId, igMediaId: media.igMediaId } },
            create: { businessId, source: "INSTAGRAM", igMediaId: media.igMediaId },
            update: {},
            select: { id: true },
          })
        : null;
      out.push({ rowId: row?.id ?? "", dtoId: id, source: "INSTAGRAM", url: null, igMediaId: media.igMediaId, title: null });
      continue;
    }
    if (!demo) throw notFound("Photo");
    const [photoKey, look] = ref!.key.split("~");
    const source: GalleryPhotoSource = look ? "AI_GENERATED" : "SAMPLE";
    const row = create
      ? await db.galleryPhoto.upsert({
          where: { businessId_sampleKey: { businessId, sampleKey: ref!.key } },
          create: { businessId, source, sampleKey: ref!.key },
          update: {},
          select: { id: true },
        })
      : null;
    const [account, file] = [photoKey.slice(0, photoKey.lastIndexOf("-")), photoKey.slice(photoKey.lastIndexOf("-") + 1)];
    out.push({ rowId: row?.id ?? "", dtoId: id, source, url: `/photos/${account}/${file}.jpg`, igMediaId: null, title: null });
  }
  return out;
}

export async function setFavorite(businessId: string, ids: string[], value: boolean) {
  const rows = await resolvePhotos(businessId, ids);
  await db.galleryPhoto.updateMany({ where: { businessId, id: { in: rows.map((r) => r.rowId) } }, data: { favorite: value } });
}

/** Removes photos from the Gallery: own files are deleted by the daily cron after the Undo window; Instagram posts only disappear here. */
export async function removePhotos(businessId: string, ids: string[]) {
  const rows = await resolvePhotos(businessId, ids);
  await db.galleryPhoto.updateMany({ where: { businessId, id: { in: rows.map((r) => r.rowId) } }, data: { removedAt: new Date() } });
}

/** Undo: puts removed photos back (own photos within the Undo window; hidden Instagram and sample photos any time). */
export async function restorePhotos(businessId: string, ids: string[]) {
  const refs = ids.map((id) => ({ id, ref: parsePhotoRef(id) }));
  if (refs.some((r) => !r.ref)) throw notFound("Photo");
  const own = refs.filter((r) => r.ref!.kind === "own").map((r) => r.id);
  const rows = own.length ? await resolvePhotos(businessId, own, { removed: true }) : [];
  const igIds = refs.flatMap((r) => (r.ref!.kind === "instagram" ? [r.ref!.igMediaId] : []));
  const sampleKeys = refs.flatMap((r) => (r.ref!.kind === "sample" ? [r.ref!.key] : []));
  await db.galleryPhoto.updateMany({
    where: {
      businessId,
      OR: [{ id: { in: rows.map((r) => r.rowId) } }, { igMediaId: { in: igIds } }, { sampleKey: { in: sampleKeys } }],
    },
    data: { removedAt: null },
  });
}

async function ownAlbum(businessId: string, albumId: string) {
  const album = await db.galleryAlbum.findFirst({ where: { id: albumId, businessId }, select: { id: true, name: true } });
  if (!album) throw notFound("Album");
  return album;
}

/** A new album at the end (or at `position`, when Undo puts a deleted one back), optionally with photos. */
export async function createAlbum(businessId: string, input: { name: string; photoIds?: string[]; position?: number }): Promise<GalleryAlbumDto> {
  if ((await db.galleryAlbum.count({ where: { businessId } })) >= GALLERY_MAX_ALBUMS) {
    throw new ApiError(409, "album_limit", `You can have up to ${GALLERY_MAX_ALBUMS} albums.`);
  }
  const rows = input.photoIds?.length ? await resolvePhotos(businessId, input.photoIds) : [];
  const last = await db.galleryAlbum.aggregate({ where: { businessId }, _max: { position: true } });
  const album = await db.galleryAlbum.create({
    data: {
      businessId,
      name: input.name,
      position: input.position ?? (last._max.position ?? -1) + 1,
      photos: { create: rows.map((r) => ({ photoId: r.rowId })) },
    },
    select: { id: true, name: true },
  });
  return album;
}

export async function renameAlbum(businessId: string, albumId: string, name: string): Promise<GalleryAlbumDto> {
  await ownAlbum(businessId, albumId);
  return db.galleryAlbum.update({ where: { id: albumId }, data: { name }, select: { id: true, name: true } });
}

/** Deletes the album only; its photos stay in the Gallery. */
export async function deleteAlbum(businessId: string, albumId: string) {
  await ownAlbum(businessId, albumId);
  await db.galleryAlbum.delete({ where: { id: albumId } });
}

/** Adds photos to an album, or moves them there out of `moveFrom` (another of the business's albums). */
export async function addToAlbum(businessId: string, albumId: string, ids: string[], moveFrom?: string) {
  await ownAlbum(businessId, albumId);
  if (moveFrom) await ownAlbum(businessId, moveFrom);
  const rows = await resolvePhotos(businessId, ids);
  const photoIds = rows.map((r) => r.rowId);
  await db.$transaction([
    db.galleryAlbumPhoto.createMany({ data: photoIds.map((photoId) => ({ albumId, photoId })), skipDuplicates: true }),
    ...(moveFrom && moveFrom !== albumId ? [db.galleryAlbumPhoto.deleteMany({ where: { albumId: moveFrom, photoId: { in: photoIds } } })] : []),
  ]);
}
