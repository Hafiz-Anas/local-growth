import { categoriesFor, categoryAlbumId } from "@/mock-data/gallery/categories";
import { initialPhotos } from "@/mock-data/gallery/photos";
import type { AccountId, CustomAlbum, L, Photo } from "@/mock-data/gallery/types";
import type { GalleryDraftDto, GalleryDto, GalleryPhotoDto } from "@/types/api";
import { SAMPLE_PREFIX, samplePhotoId, splitSampleKey } from "./refs";

/**
 * The server's Gallery (GET /api/gallery) as the screens' photos and albums (the design proposal's
 * Photo / CustomAlbum shapes, so its screens stay as they are).
 *  - Real businesses: only their own photos, AI images, drafts and Instagram posts; only their own albums.
 *  - Demo businesses: the sample account's photos and category albums too, each photo marked `sample`.
 *    A sample photo keeps its sample id on screen ("mathanet-07", which saved AI chats refer to); the
 *    server knows it as "sample:mathanet-07" (apiId / screenId below).
 */

/** The id the API uses for a photo on screen. */
export const apiId = (photo: Pick<Photo, "id" | "sample">) => (photo.sample ? samplePhotoId(photo.id) : photo.id);
/** The id on screen for an id from the API. */
export const screenId = (id: string) => (id.startsWith(SAMPLE_PREFIX) ? id.slice(SAMPLE_PREFIX.length) : id);

const UNTITLED: L = { en: "Photo", ar: "صورة" };

function draftCaption(draft: GalleryDraftDto): L {
  return { en: draft.captionEn || draft.captionAr, ar: draft.captionAr || draft.captionEn };
}

/** Draft state on a photo: status "draft" with the draft's caption (a posted Instagram photo stays posted). */
function withDraft(photo: Photo, draft: GalleryDraftDto | undefined): Photo {
  if (!draft || photo.status === "published") return photo;
  return {
    ...photo,
    status: "draft",
    caption: draftCaption(draft),
    draftId: draft.id,
    hashtags: draft.hashtags,
    suggestedFor: draft.suggestedFor ?? undefined,
    captionVersions: draft.versions,
    aiPost: draft.origin === "ai_chat" || photo.aiPost,
  };
}

function ownPhoto(p: GalleryPhotoDto, accountId: string): Photo {
  const ig = p.instagram;
  const title = p.title ? { en: p.title, ar: p.title } : UNTITLED;
  return {
    id: p.id,
    accountId,
    src: p.url ?? "",
    thumb: p.thumbUrl ?? p.url ?? "",
    dish: title,
    takenAt: p.createdAt,
    status: ig ? "published" : "none",
    source: p.source,
    favorite: p.favorite,
    albums: p.albumIds,
    credit: { author: "", link: "" },
    ...(ig && {
      caption: { en: ig.caption, ar: ig.caption },
      publishedAt: ig.postedAt,
      postType: ig.format,
      permalink: ig.permalink ?? undefined,
      metrics: { likes: ig.likes, comments: ig.comments, reach: ig.reach ?? 0, saves: ig.saves ?? 0, shares: ig.shares ?? 0, reachByDay: [] },
      metricsPartial: ig.reach === null,
    }),
  };
}

export interface HydratedGallery {
  photos: Photo[];
  albums: CustomAlbum[];
}

export function hydrateGallery(dto: GalleryDto, sampleAccount: AccountId): HydratedGallery {
  const drafts = new Map(dto.drafts.map((d) => [d.id, d]));
  const accountId = dto.demo ? sampleAccount : "own";
  const photos: Photo[] = [];

  for (const p of dto.photos) {
    if (p.sample) continue;
    photos.push(withDraft(ownPhoto(p, accountId), p.draftId ? drafts.get(p.draftId) : undefined));
  }

  const customAlbums: CustomAlbum[] = dto.albums.map((a) => ({ id: a.id, name: { en: a.name, ar: a.name } }));
  if (!dto.demo) return { photos: sortNewest(photos), albums: customAlbums };

  // Demo: the sample photos, with what the owner did to them (favourites, albums, drafts, hidden).
  const state = new Map(dto.photos.filter((p) => p.sample).map((p) => [screenId(p.id), p]));
  const hidden = new Set(dto.hidden.map(screenId));
  const samples = initialPhotos[sampleAccount] ?? [];
  const overlay = (photo: Photo): Photo => {
    const s = state.get(photo.id);
    const marked: Photo = { ...photo, sample: true };
    if (!s) return marked;
    return withDraft({ ...marked, favorite: s.favorite, albums: [...photo.albums.filter((a) => a.startsWith("cat-")), ...s.albumIds] }, s.draftId ? drafts.get(s.draftId) : undefined);
  };
  for (const photo of samples) if (!hidden.has(photo.id)) photos.push(overlay(structuredClone(photo)));
  // Sample AI images the owner kept ("mathanet-07~2"): the sample photo with that look.
  for (const id of state.keys()) {
    const { photoId, look } = splitSampleKey(id);
    const base = look ? samples.find((p) => p.id === photoId) : undefined;
    if (!base || hidden.has(id)) continue;
    const s = state.get(id)!;
    photos.push(
      overlay({ ...structuredClone(base), id, look, source: "ai", status: "none", caption: undefined, metrics: undefined, publishedAt: undefined, scheduledFor: undefined, takenAt: s.createdAt, favorite: false }),
    );
  }
  const categoryAlbums: CustomAlbum[] = categoriesFor(sampleAccount).map((c) => ({ id: categoryAlbumId(c.id), name: c.name, category: c.id }));
  return { photos: sortNewest(photos), albums: [...categoryAlbums, ...customAlbums] };
}

const sortNewest = (photos: Photo[]) => photos.sort((a, b) => b.takenAt.localeCompare(a.takenAt));
