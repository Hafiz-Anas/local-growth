"use client";

import { put } from "@vercel/blob/client";
import { ApiClientError, apiFetch, apiUpload } from "@/lib/api/client";
import type { GalleryPhotoDto, GalleryUploadTicketDto } from "@/types/api";
import {
  GALLERY_MAX_BATCH,
  GALLERY_UPLOAD_MAX_BYTES,
  GALLERY_UPLOAD_PARALLEL,
  checkPickedPhoto,
  fitWithin,
  keepsOriginal,
  mapLimited,
  type PickProblem,
} from "./uploads";

/**
 * Uploads photos picked on a phone or computer to the Gallery (BE1): each one is checked, made smaller in
 * the browser (at most GALLERY_MAX_EDGE px, JPEG), then sent straight to storage with a one-file permission
 * from POST /api/gallery/uploads — never through our API, so Vercel's 4.5 MB request limit doesn't apply —
 * and finally checked again by the server (…/complete). A file that fails doesn't stop the others.
 */

export type UploadProblem = PickProblem | "failed";
export interface UploadResult {
  photos: GalleryPhotoDto[];
  failures: Array<{ name: string; problem: UploadProblem }>;
  /** Files over GALLERY_MAX_BATCH that weren't sent. */
  skipped: number;
}

interface Prepared {
  name: string;
  blob: Blob;
  type: "image/jpeg";
}

/** Draws the photo smaller as a JPEG (upright, white behind transparency); null when the browser can't read it (e.g. HEIC outside Safari). */
async function prepare(file: File): Promise<Prepared | null> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  try {
    if (keepsOriginal(file, bitmap.width, bitmap.height)) return { name, blob: file, type: "image/jpeg" };
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    for (const quality of [0.85, 0.7]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= GALLERY_UPLOAD_MAX_BYTES) return { name, blob, type: "image/jpeg" };
    }
    return null;
  } finally {
    bitmap.close();
  }
}

async function send(ticket: GalleryUploadTicketDto, file: Prepared): Promise<GalleryPhotoDto> {
  let url: string;
  if (ticket.mode === "blob") {
    const blob = await put(ticket.pathname!, file.blob, { access: "public", token: ticket.token!, contentType: file.type });
    url = blob.url;
  } else {
    const form = new FormData();
    form.append("file", file.blob, file.name);
    url = (await apiUpload<{ url: string }>(ticket.uploadUrl!, form, "PUT")).url;
  }
  return apiFetch<GalleryPhotoDto>(`/api/gallery/uploads/${ticket.id}/complete`, { method: "POST", body: { url } });
}

/**
 * Uploads `files` (up to GALLERY_MAX_BATCH). `onProgress(done, total)` after each one. Throws only when the
 * upload permissions can't be had at all (offline, storage not set up, too many uploads).
 */
export async function uploadGalleryPhotos(picked: File[], onProgress?: (done: number, total: number) => void): Promise<UploadResult> {
  const files = picked.slice(0, GALLERY_MAX_BATCH);
  const failures: UploadResult["failures"] = [];
  const ready: Prepared[] = [];
  for (const file of files) {
    const problem = checkPickedPhoto(file);
    if (problem) {
      failures.push({ name: file.name, problem });
      continue;
    }
    const prepared = await prepare(file);
    if (prepared) ready.push(prepared);
    else failures.push({ name: file.name, problem: file.size > GALLERY_UPLOAD_MAX_BYTES ? "size" : "type" });
  }
  let done = files.length - ready.length;
  onProgress?.(done, files.length);
  if (!ready.length) return { photos: [], failures, skipped: picked.length - files.length };

  const tickets = await apiFetch<GalleryUploadTicketDto[]>("/api/gallery/uploads", {
    method: "POST",
    body: { files: ready.map((f) => ({ name: f.name, type: f.type, size: f.blob.size })) },
  });
  const results = await mapLimited(ready, GALLERY_UPLOAD_PARALLEL, async (file, i) => {
    try {
      return await send(tickets[i], file);
    } catch (error) {
      const reason = error instanceof ApiClientError && error.code === "upload_invalid" ? (error.details as Array<{ message: string }> | undefined)?.[0]?.message : null;
      failures.push({ name: file.name, problem: reason === "type" || reason === "size" ? reason : "failed" });
      return null;
    } finally {
      onProgress?.(++done, files.length);
    }
  });
  return { photos: results.filter((p): p is GalleryPhotoDto => p !== null), failures, skipped: picked.length - files.length };
}
