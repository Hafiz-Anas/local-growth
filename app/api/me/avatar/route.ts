import { db } from "@/lib/db";
import { logActivity } from "@/lib/server/activity";
import { requireAuth } from "@/lib/server/guards";
import { handler, ok } from "@/lib/server/http";
import { readUpload } from "@/lib/server/uploads";
import { CONTENT_TYPES, getStorageService } from "@/lib/services/storage";

const MAX_BYTES = 2 * 1024 * 1024;

/**
 * POST /api/me/avatar  (multipart/form-data, field "file")
 * JPG, PNG or WebP up to 2 MB. Saves through StorageService, points the user's
 * avatarUrl (and their business's, for business users) at it, and deletes the
 * previous uploaded file.
 */
export const POST = handler(async (request) => {
  const session = await requireAuth();
  const { data, extension } = await readUpload(request, { imageMax: MAX_BYTES, labels: { image: "2 MB" } });

  const storage = getStorageService();
  const stored = await storage.save({ data, contentType: CONTENT_TYPES[extension], prefix: "avatars", extension });

  const before = await db.user.findUniqueOrThrow({
    where: { id: session.userId },
    select: { avatarUrl: true, business: { select: { id: true, avatarUrl: true } } },
  });
  const isBusinessUser = session.role === "user" && before.business;
  try {
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: session.userId }, data: { avatarUrl: stored.url } });
      // The business's profile photo is the user's photo in this app.
      if (isBusinessUser) await tx.business.update({ where: { id: before.business!.id }, data: { avatarUrl: stored.url } });
      await logActivity({ businessId: before.business?.id ?? null, userId: session.userId, action: "user.avatar_updated" }, tx);
    });
  } catch (error) {
    await storage.delete(stored.key);
    throw error;
  }

  // Remove replaced uploads that nothing else points to (seeded /avatars/*.svg are never touched).
  const oldUrls = new Set([before.avatarUrl, isBusinessUser ? before.business?.avatarUrl : null].filter((u): u is string => Boolean(u)));
  for (const url of oldUrls) {
    const key = storage.keyFromUrl(url);
    if (!key || url === stored.url) continue;
    const stillUsed = (await db.user.count({ where: { avatarUrl: url } })) + (await db.business.count({ where: { avatarUrl: url } }));
    if (stillUsed === 0) await storage.delete(key);
  }

  return ok({ avatarUrl: stored.url });
});
