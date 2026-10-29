"use client";

import { useEffect, useLayoutEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useActiveClient } from "@/components/providers/active-client-provider";
import { qk } from "@/lib/api/queries";
import { reportError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";
import { galleryApi } from "@/lib/gallery/api";
import { useStore } from "@/lib/gallery/store";
import { notify } from "@/store/ui-store";
import type { AccountId } from "@/mock-data/gallery/types";
import type { Client } from "@/types";

/**
 * Loads the business's Gallery (GET /api/gallery; in admin preview the read-only copy) into the Gallery and
 * AI chat store, and reloads it when a change is refused. Demo businesses also get the closest of the three
 * sample accounts (home cooking, café, bakery) — its photos marked "Sample" — shown with the business's own
 * @handle and picture; the AI chat's sample answers use that account for every business. The language
 * follows the app. Also loads the business's saved inspiration and AI chats, both kept in this browser.
 */
export function mockAccountFor(client: Pick<Client, "handle" | "businessName" | "category">): AccountId {
  const text = `${client.handle} ${client.businessName} ${client.category}`.toLowerCase();
  if (/mathanet|home.?cook|بيت/.test(text)) return "mathanet";
  if (/caf|coffee|qahw|dalla|bean|قهوة|كوفي/.test(text)) return "qahwa";
  if (/bake|bakery|tannour|bread|مخبز|مخبوزات/.test(text)) return "tannour";
  return "mathanet";
}

/** The Gallery query (one cache entry: GallerySync loads it into the store, screens read its loading / error state). */
export function useGalleryQuery() {
  const { client, isPreview } = useActiveClient();
  return useQuery({ queryKey: [...qk.gallery, isPreview ? client.id : "own"], queryFn: () => galleryApi.get(isPreview ? client.id : undefined) });
}

export function GallerySync() {
  const { client, isPreview } = useActiveClient();
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();
  const account = mockAccountFor(client);
  const handle = client.instagramHandle ?? client.handle;
  const avatar = client.avatarUrl ?? "";
  const gallery = useGalleryQuery();

  // Before paint, so the first frame already shows this business's language and account.
  useLayoutEffect(() => useStore.getState().setLang(locale), [locale]);
  useLayoutEffect(() => useStore.getState().setBusiness(account, { handle, avatar }), [account, handle, avatar]);
  useLayoutEffect(() => useStore.getState().loadInspiration(client.id), [client.id]);
  useLayoutEffect(() => {
    useStore.getState().setSyncHooks(
      {
        refetch: () => void queryClient.invalidateQueries({ queryKey: qk.gallery }),
        report: (error) => reportError(error, t),
        blocked: () => notify.info(t("preview.readOnly")),
      },
      isPreview,
    );
  }, [queryClient, t, isPreview]);

  const data = gallery.data;
  useEffect(() => {
    if (!data) return;
    const store = useStore.getState();
    store.setGallery(data);
    // After setBusiness: the chats belong to the account it picked; only demo businesses get the sample ones.
    store.loadChats(client.id, data.demo);
  }, [data, account, client.id]);
  return null;
}
