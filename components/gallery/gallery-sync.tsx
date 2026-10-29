"use client";

import { useLayoutEffect } from "react";
import { useActiveClient } from "@/components/providers/active-client-provider";
import { useI18n } from "@/lib/i18n/provider";
import { useStore } from "@/lib/gallery/store";
import type { AccountId } from "@/mock-data/gallery/types";
import type { Client } from "@/types";

/**
 * The Gallery and AI chat run on the design proposal's mock data. Each business gets the closest of
 * its three sample accounts (home cooking, café, bakery), shown with the business's own @handle and
 * picture on posts. The language follows the app. Also loads the business's saved inspiration
 * (competitor posts) and its AI chats, both kept in this browser.
 */
export function mockAccountFor(client: Pick<Client, "handle" | "businessName" | "category">): AccountId {
  const text = `${client.handle} ${client.businessName} ${client.category}`.toLowerCase();
  if (/mathanet|home.?cook|بيت/.test(text)) return "mathanet";
  if (/caf|coffee|qahw|dalla|bean|قهوة|كوفي/.test(text)) return "qahwa";
  if (/bake|bakery|tannour|bread|مخبز|مخبوزات/.test(text)) return "tannour";
  return "mathanet";
}

export function GallerySync() {
  const { client } = useActiveClient();
  const { locale } = useI18n();
  const account = mockAccountFor(client);
  const handle = client.instagramHandle ?? client.handle;
  const avatar = client.avatarUrl ?? "";

  // Before paint, so the first frame already shows this business's data and language.
  useLayoutEffect(() => useStore.getState().setLang(locale), [locale]);
  useLayoutEffect(() => useStore.getState().setBusiness(account, { handle, avatar }), [account, handle, avatar]);
  useLayoutEffect(() => useStore.getState().loadInspiration(client.id), [client.id]);
  // After setBusiness: the chats belong to the sample account it picked.
  useLayoutEffect(() => useStore.getState().loadChats(client.id), [client.id]);
  return null;
}
