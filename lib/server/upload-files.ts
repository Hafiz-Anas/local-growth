import "server-only";
import { db } from "@/lib/db";
import { getStorageService } from "@/lib/services/storage";

/**
 * Deletes one of our stored files only when nothing uses it any more. One upload can be several things at
 * once — a brand post, a "Your style" photo, a Gallery photo (they're copied into the Gallery), a logo, an
 * avatar, a post's image — so removing it from one place must never break another.
 */
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
    db.scheduledPost.count({ where: { OR: [{ mediaUrl: url }, { mediaUrls: { has: url } }] } }),
    db.galleryPhoto.count({ where: { OR: [{ url }, { storageKey: key }] } }),
    db.styleGuide.count({ where: { photos: { array_contains: [{ source: "upload", url }] } } }),
  ]);
  if (uses.every((n) => n === 0)) await storage.delete(key);
}
