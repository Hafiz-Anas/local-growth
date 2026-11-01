"use client";

import { apiFetch } from "@/lib/api/client";
import type { GalleryAlbumDto, GalleryDraftDto, GalleryDto, PhotoCaptionDto, ScheduledPostDto } from "@/types/api";

/** The Gallery's API calls (app/api/gallery). Ids are the server's: own ids, "ig:…" or "sample:…" (lib/gallery/refs.ts). */

type Both = { en: string; ar: string };

export const galleryApi = {
  get: (previewBusinessId?: string) => apiFetch<GalleryDto>(previewBusinessId ? `/api/admin/preview/${previewBusinessId}/gallery` : "/api/gallery"),
  favorite: (ids: string[], value: boolean) => apiFetch("/api/gallery/favorites", { method: "POST", body: { ids, value } }),
  remove: (ids: string[]) => apiFetch("/api/gallery/remove", { method: "POST", body: { ids } }),
  restore: (ids: string[]) => apiFetch("/api/gallery/restore", { method: "POST", body: { ids } }),
  createAlbum: (body: { name: string; photoIds?: string[]; position?: number }) => apiFetch<GalleryAlbumDto>("/api/gallery/albums", { method: "POST", body }),
  renameAlbum: (id: string, name: string) => apiFetch<GalleryAlbumDto>(`/api/gallery/albums/${id}`, { method: "PATCH", body: { name } }),
  deleteAlbum: (id: string) => apiFetch(`/api/gallery/albums/${id}`, { method: "DELETE" }),
  addToAlbum: (id: string, ids: string[], moveFrom?: string) => apiFetch(`/api/gallery/albums/${id}/photos`, { method: "POST", body: { ids, moveFrom } }),
  createDraft: (body: { photoIds: string[]; caption: Both; hashtags: string[]; suggestedFor?: string | null; versions?: GalleryDraftDto["versions"]; origin: "ai_chat" | "gallery" }) =>
    apiFetch<GalleryDraftDto>("/api/gallery/drafts", { method: "POST", body }),
  updateDraft: (id: string, body: { caption?: Both; hashtags?: string[]; suggestedFor?: string | null; regenerated?: boolean }) =>
    apiFetch<GalleryDraftDto>(`/api/gallery/drafts/${id}`, { method: "PATCH", body }),
  /** Approves a draft for publishing: at a time, or now (lib/server/publishing.ts approveDraft). */
  schedule: (draftId: string, body: { scheduledFor: string; language?: "en" | "ar" } | { now: true; language?: "en" | "ar" }) =>
    apiFetch<GalleryDraftDto>(`/api/gallery/drafts/${draftId}/schedule`, { method: "POST", body }),
  /** Moves a scheduled post, or tries a failed one again (now: true posts it now). */
  reschedule: (jobId: string, body: { scheduledFor: string } | { now: true }) => apiFetch<ScheduledPostDto>(`/api/scheduled-posts/${jobId}`, { method: "PATCH", body }),
  /** Cancels a scheduled post (or dismisses a failed one): it is a draft again. */
  cancel: (jobId: string) => apiFetch<{ cancelled: true }>(`/api/scheduled-posts/${jobId}`, { method: "DELETE" }),
  caption: (body: { photoIds: string[]; tone?: "base" | "shorter" | "formal" | "friendly"; request?: string }) =>
    apiFetch<PhotoCaptionDto>("/api/gallery/caption", { method: "POST", body }),
};
