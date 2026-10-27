"use client";

import { create } from "zustand";
import { accounts as mockAccounts } from "@/mock-data/gallery/accounts";
import { categoriesFor, categoryAlbumId } from "@/mock-data/gallery/categories";
import type { ChatMode } from "@/mock-data/gallery/ai-chat";
import { NOW } from "@/mock-data/gallery/clock";
import { competitors as mockCompetitors } from "@/mock-data/gallery/competitors";
import { seedChats, type AiChat, type AiMsg } from "@/mock-data/gallery/ai-studio";
import { insights as mockInsights } from "@/mock-data/gallery/insights";
import { initialPhotos, seeded } from "@/mock-data/gallery/photos";
import type { Account, AccountId, Competitor, CustomAlbum, L, Lang, Photo } from "@/mock-data/gallery/types";

/*
 * The Gallery and AI chat state, copied from the design proposal (lib/store.ts there) without its
 * other demo screens. Front-end only: everything is mock data (mock-data/gallery) held in memory,
 * so it resets on a page load. Nothing is uploaded, stored, published or sent to the server.
 */

export type SheetState =
  | { type: "schedule"; photoIds: string[]; caption?: L; suggested?: string }
  | { type: "album"; photoIds: string[]; fromAlbumId?: string }
  | { type: "albumName"; albumId?: string; photoIds?: string[] }
  | { type: "post"; photoId: string }
  | { type: "upload" }
  | { type: "performance"; photoId: string };

type PerAccount<T> = Record<string, T>;
type RemovedAlbum = { album: CustomAlbum; index: number; photoIds: string[] };

interface DemoData {
  accounts: Account[];
  photos: PerAccount<Photo[]>;
  albums: PerAccount<CustomAlbum[]>;
  competitors: PerAccount<Competitor[]>;
  chats: PerAccount<AiChat[]>;
  lastAnalysis: PerAccount<string | undefined>;
}

interface State extends DemoData {
  /** The app's language, kept in sync by <GallerySync> for code outside React (translate()). */
  lang: Lang;
  /** Which mock data set (mock-data/gallery) the signed-in business sees. */
  activeAccountId: AccountId;
  sheet: SheetState | null;
  viewer: { ids: string[]; index: number } | null;
  chatMode: ChatMode;
  /** Open AI chat; null shows a new, empty chat. */
  activeChatId: string | null;
  /** What's in the AI chat input: text and attached photos. */
  composer: { text: string; photoIds: string[] };
  /** Gallery select mode: its toolbar sits above the tab bar. */
  selecting: boolean;
  setSelecting: (value: boolean) => void;
  /** Kept from the proposal: screens show a short skeleton when it changes. */
  switchTick: number;

  setLang: (lang: Lang) => void;
  /** Picks the mock data set for the signed-in business and shows its own handle and picture on posts. */
  setBusiness: (id: AccountId, profile: { handle: string; avatar: string }) => void;
  openSheet: (sheet: SheetState) => void;
  closeSheet: () => void;
  openViewer: (ids: string[], index: number) => void;
  setViewerIndex: (index: number) => void;
  closeViewer: () => void;

  toggleFavorite: (ids: string[], value?: boolean) => void;
  deletePhotos: (ids: string[]) => Photo[];
  restorePhotos: (photos: Photo[]) => void;
  createAlbum: (name: string) => string;
  renameAlbum: (id: string, name: string) => void;
  /** Deletes the album only; its photos stay in the library. Returns what Undo needs. */
  deleteAlbum: (id: string) => RemovedAlbum | undefined;
  restoreAlbum: (removed: RemovedAlbum) => void;
  /** Adds photos to an album, or moves them out of `moveFrom`. A category album also sets their category. */
  addToAlbum: (ids: string[], albumId: string, moveFrom?: string) => void;
  uploadPhotos: (items: Pick<Photo, "src" | "thumb" | "dish" | "credit" | "category">[]) => void;
  /** Saves an AI-made image into the gallery (AI Generated + its category album). Returns its id. */
  addAiImage: (item: Pick<Photo, "src" | "thumb" | "dish" | "credit" | "category" | "look">) => string;
  /** Saves an AI post (photo + caption with hashtags) to the gallery without scheduling it. */
  savePost: (ids: string[], caption: L) => void;
  updateCaption: (ids: string[], caption: L) => void;
  schedulePhotos: (ids: string[], at: string, caption?: L) => void;
  /** Mock "Post now": marks the photos published in the gallery. Nothing is sent to Instagram. */
  publishPhotos: (ids: string[], caption: L) => void;
  saveDraftPhotos: (ids: string[], caption: L) => void;

  setChatMode: (mode: ChatMode) => void;
  setComposer: (composer: Partial<State["composer"]>) => void;
  newChat: () => void;
  openChat: (id: string) => void;
  /** Adds messages to the open chat, starting a new chat if none is open. Returns the chat id. */
  pushAi: (msgs: AiMsg[], opts?: { title?: L; chatId?: string }) => string;
  updateAiMsg: (msgId: string, patch: Partial<AiMsg>) => void;
}

function freshData(): DemoData {
  const ids = ["mathanet", "qahwa", "tannour"] as const;
  const per = <T,>(f: (id: AccountId) => T) => Object.fromEntries(ids.map((id) => [id, f(id)])) as PerAccount<T>;
  return {
    accounts: structuredClone(mockAccounts),
    photos: per((id) => structuredClone(initialPhotos[id])),
    albums: per((id) => categoriesFor(id).map((c) => ({ id: categoryAlbumId(c.id), name: c.name, category: c.id }))),
    competitors: per((id) => structuredClone(mockCompetitors[id])),
    chats: per((id) =>
      seedChats({
        account: mockAccounts.find((a) => a.id === id)!,
        photos: initialPhotos[id],
        insights: mockInsights[id],
        competitors: mockCompetitors[id],
      }),
    ),
    lastAnalysis: per(() => undefined),
  };
}

let uid = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${uid++}`;

export const useStore = create<State>()((set, get) => {
  const acc = () => get().activeAccountId;
  const mapPhotos = (ids: string[], f: (p: Photo) => Photo) =>
    set((s) => ({ photos: { ...s.photos, [acc()]: s.photos[acc()].map((p) => (ids.includes(p.id) ? f(p) : p)) } }));

  return {
    ...freshData(),
    lang: "en",
    activeAccountId: "mathanet",
    sheet: null,
    viewer: null,
    chatMode: "post",
    activeChatId: null,
    composer: { text: "", photoIds: [] },
    selecting: false,
    setSelecting: (selecting) => set({ selecting }),
    switchTick: 0,

    setLang: (lang) => set({ lang }),
    setBusiness: (id, profile) =>
      set((s) => ({ activeAccountId: id, accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...profile } : a)) })),
    openSheet: (sheet) => set({ sheet }),
    closeSheet: () => set({ sheet: null }),
    openViewer: (ids, index) => set({ viewer: { ids, index } }),
    setViewerIndex: (index) => set((s) => (s.viewer ? { viewer: { ...s.viewer, index } } : {})),
    closeViewer: () => set({ viewer: null }),

    toggleFavorite: (ids, value) => mapPhotos(ids, (p) => ({ ...p, favorite: value ?? !p.favorite })),
    deletePhotos: (ids) => {
      const removed = get().photos[acc()].filter((p) => ids.includes(p.id));
      set((s) => ({
        photos: { ...s.photos, [acc()]: s.photos[acc()].filter((p) => !ids.includes(p.id)) },
        composer: { ...s.composer, photoIds: s.composer.photoIds.filter((id) => !ids.includes(id)) },
      }));
      return removed;
    },
    restorePhotos: (photos) =>
      set((s) => ({
        photos: {
          ...s.photos,
          [acc()]: [...s.photos[acc()], ...photos].sort((a, b) => b.takenAt.localeCompare(a.takenAt)),
        },
      })),
    createAlbum: (name) => {
      const id = nextId("album");
      set((s) => ({ albums: { ...s.albums, [acc()]: [...s.albums[acc()], { id, name: { en: name, ar: name } }] } }));
      return id;
    },
    renameAlbum: (id, name) =>
      set((s) => ({ albums: { ...s.albums, [acc()]: s.albums[acc()].map((a) => (a.id === id ? { ...a, name: { en: name, ar: name } } : a)) } })),
    deleteAlbum: (id) => {
      const list = get().albums[acc()];
      const index = list.findIndex((a) => a.id === id);
      if (index < 0) return undefined;
      const photoIds = get().photos[acc()].filter((p) => p.albums.includes(id)).map((p) => p.id);
      set((s) => ({
        albums: { ...s.albums, [acc()]: list.filter((a) => a.id !== id) },
        photos: { ...s.photos, [acc()]: s.photos[acc()].map((p) => (p.albums.includes(id) ? { ...p, albums: p.albums.filter((a) => a !== id) } : p)) },
      }));
      return { album: list[index], index, photoIds };
    },
    restoreAlbum: ({ album, index, photoIds }) => {
      set((s) => {
        const list = [...s.albums[acc()]];
        list.splice(index, 0, album);
        return { albums: { ...s.albums, [acc()]: list } };
      });
      mapPhotos(photoIds, (p) => ({ ...p, albums: [...p.albums, album.id] }));
    },
    addToAlbum: (ids, albumId, moveFrom) => {
      const category = get().albums[acc()].find((a) => a.id === albumId)?.category;
      mapPhotos(ids, (p) => ({ ...p, albums: [...p.albums.filter((a) => a !== moveFrom && a !== albumId), albumId], category: category ?? p.category }));
    },
    uploadPhotos: (items) =>
      set((s) => {
        const added: Photo[] = items.map((it, i) => ({
          ...it,
          id: nextId("upload"),
          accountId: acc(),
          takenAt: new Date(NOW.getTime() - i * 1000).toISOString(),
          status: "none",
          source: "upload",
          favorite: false,
          albums: it.category ? [categoryAlbumId(it.category)] : [],
        }));
        return { photos: { ...s.photos, [acc()]: [...added, ...s.photos[acc()]] } };
      }),
    addAiImage: (item) => {
      const id = nextId("ai");
      const photo: Photo = {
        ...item,
        id,
        accountId: acc(),
        takenAt: NOW.toISOString(),
        status: "none",
        source: "ai",
        favorite: false,
        albums: item.category ? [categoryAlbumId(item.category)] : [],
      };
      set((s) => ({ photos: { ...s.photos, [acc()]: [photo, ...s.photos[acc()]] } }));
      return id;
    },
    savePost: (ids, caption) =>
      mapPhotos(ids, (p) => ({
        ...p,
        caption,
        aiPost: true,
        status: p.status === "none" ? "draft" : p.status,
        albums: p.category && !p.albums.includes(categoryAlbumId(p.category)) ? [...p.albums, categoryAlbumId(p.category)] : p.albums,
      })),
    updateCaption: (ids, caption) => mapPhotos(ids, (p) => ({ ...p, caption })),
    schedulePhotos: (ids, at, caption) =>
      mapPhotos(ids, (p) => ({ ...p, status: "scheduled", scheduledFor: at, caption: caption ?? p.caption })),
    publishPhotos: (ids, caption) => {
      const rand = seeded(ids.join("").length);
      mapPhotos(ids, (p) => ({
        ...p,
        status: "published",
        source: p.source === "ai" ? "ai" : "instagram",
        publishedAt: NOW.toISOString(),
        postType: ids.length > 1 ? "carousel" : "photo",
        caption,
        metrics: { likes: 0, comments: 0, reach: Math.round(40 + rand() * 60), saves: 0, shares: 0, reachByDay: [Math.round(40 + rand() * 60)] },
      }));
    },
    saveDraftPhotos: (ids, caption) => mapPhotos(ids, (p) => ({ ...p, status: p.status === "published" ? p.status : "draft", caption })),

    setChatMode: (chatMode) => set({ chatMode }),
    setComposer: (patch) => set((s) => ({ composer: { ...s.composer, ...patch } })),
    newChat: () => set({ activeChatId: null, composer: { text: "", photoIds: [] } }),
    openChat: (id) => {
      const chat = (get().chats[acc()] ?? []).find((c) => c.id === id);
      set({ activeChatId: id, chatMode: chat?.mode ?? get().chatMode, composer: { text: "", photoIds: [] } });
    },
    pushAi: (msgs, opts) => {
      const s = get();
      const list = s.chats[acc()] ?? [];
      const existing = list.find((c) => c.id === (opts?.chatId ?? s.activeChatId));
      const at = NOW.toISOString();
      const chat: AiChat = existing
        ? { ...existing, at, messages: [...existing.messages, ...msgs] }
        : { id: nextId("chat"), title: opts?.title ?? { en: "New chat", ar: "محادثة جديدة" }, mode: s.chatMode, at, messages: msgs };
      // Most recent chat first, like ChatGPT. Late answers for a chat that's no longer open don't switch to it.
      set({ activeChatId: opts?.chatId ? s.activeChatId : chat.id, chats: { ...s.chats, [acc()]: [chat, ...list.filter((c) => c.id !== chat.id)] } });
      return chat.id;
    },
    updateAiMsg: (msgId, patch) =>
      set((s) => ({
        chats: {
          ...s.chats,
          [acc()]: (s.chats[acc()] ?? []).map((c) =>
            c.messages.some((m) => m.id === msgId) ? { ...c, messages: c.messages.map((m) => (m.id === msgId ? ({ ...m, ...patch } as AiMsg) : m)) } : c,
          ),
        },
      })),
  };
});

// ---- Selectors -------------------------------------------------------------

export const useLang = () => useStore((s) => s.lang);
export const useAccount = () => {
  const id = useStore((s) => s.activeAccountId);
  const accounts = useStore((s) => s.accounts);
  return accounts.find((a) => a.id === id) ?? accounts[0];
};
export const usePhotos = () => useStore((s) => s.photos[s.activeAccountId]);
export const useCompetitors = () => useStore((s) => s.competitors[s.activeAccountId]);
export const useAlbums = () => useStore((s) => s.albums[s.activeAccountId]);
export const useChats = () => useStore((s) => s.chats[s.activeAccountId] ?? EMPTY_CHATS);
export const useActiveChat = () => useStore((s) => (s.chats[s.activeAccountId] ?? EMPTY_CHATS).find((c) => c.id === s.activeChatId));
const EMPTY_CHATS: AiChat[] = [];
