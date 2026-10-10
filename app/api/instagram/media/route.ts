import { requireBusiness } from "@/lib/server/guards";
import { ApiError, handler, ok } from "@/lib/server/http";
import { getInstagramAccount } from "@/lib/server/instagram-account";
import { getInstagramService } from "@/lib/services/instagram";
import type { PickableMediaDto } from "@/types";

/** GET /api/instagram/media — recent posts of the connected account, for the brand-post picker. */
export const GET = handler(async () => {
  const { businessId } = await requireBusiness();
  const account = await getInstagramAccount(businessId);
  if (!account.connected) throw new ApiError(409, "instagram_not_connected", "Connect Instagram to pick from your posts.");
  let media;
  try {
    media = await getInstagramService().getMedia(account, { limit: 24 });
  } catch (error) {
    console.error("[instagram] getMedia failed", error);
    throw new ApiError(502, "instagram_error", "Instagram didn't send your posts. Try again in a moment.");
  }
  const dto: PickableMediaDto[] = media.map((m) => ({ id: m.id, mediaUrl: m.mediaUrl, mediaType: m.mediaType, caption: m.caption, postedAt: m.postedAt, likes: m.likes }));
  return ok(dto);
});
