"use client";

import { toast } from "sonner";
import { num } from "@/lib/gallery/format";
import { useT } from "@/lib/gallery/hooks";
import { useStore } from "@/lib/gallery/store";
import { useOpenAi } from "@/components/ai-chat/use-open-ai";

export function usePhotoActions() {
  const { t, lang } = useT();
  const s = useStore.getState;
  const openAi = useOpenAi();

  return {
    /** Opens the AI chat with the photos attached, ready to turn into a post about them. */
    createWithAi(ids: string[]) {
      openAi(ids);
    },
    /** A ready post opens its full preview, where it can be scheduled, posted or edited. */
    openPost(id: string) {
      s().openSheet({ type: "post", photoId: id });
    },
    /** From inside an album, the sheet also offers to move the photos out of it. */
    addToAlbum(ids: string[], fromAlbumId?: string) {
      s().openSheet({ type: "album", photoIds: ids, fromAlbumId });
    },
    favorite(ids: string[], value: boolean) {
      s().toggleFavorite(ids, value);
      toast.success(value ? t("addedToFavorites") : t("removedFromFavorites"));
    },
    remove(ids: string[]) {
      const removed = s().deletePhotos(ids);
      toast.success(ids.length > 1 ? t("deletedN", { n: num(ids.length, lang) }) : t("deleted"), {
        action: { label: t("undo"), onClick: () => s().restorePhotos(removed) },
      });
    },
  };
}
