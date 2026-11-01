"use client";

import { create } from "zustand";
import { accounts as mockAccounts } from "@/mock-data/gallery/accounts";
import { NOW } from "@/mock-data/gallery/clock";
import { competitors as mockCompetitors } from "@/mock-data/gallery/competitors";
import { seedChats, type AiChat, type AiMsg } from "@/mock-data/gallery/ai-studio";
import { insights as mockInsights } from "@/mock-data/gallery/insights";
import { initialPhotos } from "@/mock-data/gallery/photos";
import type { Account, AccountId, Competitor, CustomAlbum, L, Lang, Photo } from "@/mock-data/gallery/types";
import type { AiChatSummaryDto, CaptionVersionDto, GalleryDraftDto, GalleryDto, GalleryPhotoDto } from "@/types/api";
import { galleryApi } from "./api";
import { chatsApi } from "./chats-api";
import { MAX_SAVED_INSPIRATION, inspirationStorageKey, parseSavedInspiration, type CompetitorPostRef, type SavedInspiration } from "./competitor-posts";
import { hashtagsIn } from "./drafts";
import { apiId, hydrateGallery, screenId } from "./hydrate";
import { chatsStorageKey, parseSavedChats, readChatMessages, shiftChats } from "./saved-chats";

/*
 * The Gallery and AI chat state, copied from the design proposal (lib/store.ts there) without its
 * other demo screens. The screens read photos and albums from here as before; the data itself is the
 * business's own, stored on the server (BE1/BE2): GallerySync loads GET /api/gallery into the store
 * (setGallery), and every change (favourites, albums, removing, drafts) shows at once here and is sent
 * to the API — when the API refuses, the error is shown and the Gallery is loaded again. In admin preview
 * nothing changes (readOnly). Demo businesses also see the sample photos (marked "Sample").
 * Competitor posts saved as inspiration are kept in this browser's localStorage, one list per business. The AI
 * chats are saved in the database (AI2, lib/gallery/chats-api.ts): the list loads without messages and a chat's
 * messages load when it's opened; every change is sent at once, in order per chat. Chats an older version kept
 * in localStorage are imported once and then deleted there; demo businesses get the sample chats once.
 */

/** This business's saved inspiration from localStorage; empty when storage is blocked or unreadable. */
function readSaved(businessId: string): SavedInspiration[] {
  try {
    return parseSavedInspiration(window.localStorage.getItem(inspirationStorageKey(businessId)));
  } catch {
    return [];
  }
}

function writeSaved(businessId: string | null, list: SavedInspiration[]) {
  if (!businessId) return;
  try {
    window.localStorage.setItem(inspirationStorageKey(businessId), JSON.stringify(list));
  } catch {
    // Private window / storage full: the list still works until the next page load.
  }
}

/** The AI chats an older version kept in this browser; null when there are none (or storage is blocked). */
function readLocalChats(businessId: string): AiChat[] | null {
  try {
    const raw = window.localStorage.getItem(chatsStorageKey(businessId));
    return raw === null ? null : parseSavedChats(raw);
  } catch {
    return null;
  }
}

/** Once they're imported, the old local chats are deleted: the server's are the only ones. */
function forgetLocalChats(businessId: string) {
  try {
    window.localStorage.removeItem(chatsStorageKey(businessId));
  } catch {
    // Storage blocked: nothing to delete.
  }
}

/** Each chat's API calls, in order (a chat is created before messages are added to it). */
const chatQueues = new Map<string, Promise<void>>();
/** Chats made here that the server may not have yet, and chats deleted here: a list loaded meanwhile is corrected. */
const unsavedChats = new Set<string>();
const deletedChats = new Set<string>();

export type SheetState =
  | { type: "schedule"; photoIds: string[]; caption?: L; suggested?: string }
  | { type: "album"; photoIds: string[]; fromAlbumId?: string }
  | { type: "albumName"; albumId?: string; photoIds?: string[] }
  | { type: "post"; photoId: string }
  | { type: "upload" }
  | { type: "performance"; photoId: string };

type PerAccount<T> = Record<string, T>;
type RemovedAlbum = { album: CustomAlbum; index: number; photoIds: string[] };

export interface GallerySyncHooks {
  /** Loads the Gallery from the server again (after a change the API refused). */
  refetch: () => void;
  /** Shows a failed change's error (lib/api/errors.ts). */
  report: (error: unknown) => void;
  /** Admin preview: "changes are off in preview". */
  blocked: () => void;
}

export interface DraftInput {
  photoIds: string[];
  caption: L;
  hashtags: string[];
  suggestedFor?: string | null;
  versions?: CaptionVersionDto[];
  origin: "ai_chat" | "gallery";
}

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
  /**
   * The open viewer: Gallery photos by id, or a competitor's posts (`competitor`, from their profile
   * or the Inspiration tab), which never join the library, albums or Favourites.
   */
  viewer: { ids: string[]; index: number; competitor?: CompetitorPostRef[] } | null;
  /** Open AI chat; null shows the start screen (a new, empty chat). */
  activeChatId: string | null;
  /** The business whose AI chats are loaded (GallerySync sets it); they're saved on the server. */
  chatsOwner: string | null;
  /** What's in the AI chat input: text, attached photos and a competitor post to use as a reference. */
  composer: { text: string; photoIds: string[]; reference?: CompetitorPostRef };
  /** Competitor posts saved as inspiration, newest first, for `inspirationOwner` (kept in localStorage). */
  inspiration: SavedInspiration[];
  /** The business whose saved inspiration is loaded (GallerySync sets it). */
  inspirationOwner: string | null;
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
  openCompetitorViewer: (posts: CompetitorPostRef[], index: number) => void;
  setViewerIndex: (index: number) => void;
  closeViewer: () => void;

  /** The Gallery came from the server (GallerySync); until then the screens show their skeleton. */
  galleryLoaded: boolean;
  /** A demo business (mock Instagram connection): the sample photos and category albums are shown too, marked "Sample". */
  demo: boolean;
  /** Admin preview: every change is refused with the read-only notice. */
  readOnly: boolean;
  /** Set by GallerySync: reload the Gallery, report a failed change, show the preview notice. */
  sync: GallerySyncHooks | null;
  setSyncHooks: (hooks: GallerySyncHooks, readOnly: boolean) => void;
  /** The Gallery from GET /api/gallery, for the active sample account (demo) or the business's own. */
  setGallery: (dto: GalleryDto) => void;

  toggleFavorite: (ids: string[], value?: boolean) => void;
  deletePhotos: (ids: string[]) => Photo[];
  restorePhotos: (photos: Photo[]) => void;
  /** A new album (with `photoIds` in it); resolves to its id, or null when it couldn't be made. */
  createAlbum: (name: string, photoIds?: string[]) => Promise<string | null>;
  renameAlbum: (id: string, name: string) => void;
  /** Deletes the album only; its photos stay in the library. Returns what Undo needs. */
  deleteAlbum: (id: string) => RemovedAlbum | undefined;
  restoreAlbum: (removed: RemovedAlbum) => void;
  /** Adds photos to one of the owner's albums, or moves them out of `moveFrom`. */
  addToAlbum: (ids: string[], albumId: string, moveFrom?: string) => void;
  /** Photos just uploaded (POST /api/gallery/uploads → …/complete). */
  addUploaded: (photos: GalleryPhotoDto[]) => void;
  /** Demo only: keeps a sample AI image (the sample photo with a look) in the Gallery. Returns its id. */
  addAiImage: (item: Pick<Photo, "src" | "thumb" | "dish" | "credit" | "category" | "look">) => string;
  /** Saves a post (photos, caption with hashtags, suggested time) as a real draft. Resolves to the draft's id, or null. */
  saveDraft: (input: DraftInput) => Promise<string | null>;
  /** Edits a saved draft (`regenerated`: the caption came from Regenerate, so the old one is kept as a version). */
  updateDraft: (draftId: string, patch: { caption?: L; hashtags?: string[]; suggestedFor?: string | null; regenerated?: boolean }) => Promise<boolean>;
  /** Edits the caption of a photo's draft (Gallery → Open post → Edit); resolves once it's saved (false if not). */
  updateCaption: (ids: string[], caption: L) => Promise<boolean>;

  setComposer: (composer: Partial<State["composer"]>) => void;
  /** Saves the post as inspiration, or removes it when it's already saved. Returns whether it's saved now. */
  toggleInspiration: (post: CompetitorPostRef) => boolean;
  /** Loads the business's saved inspiration from this browser. */
  loadInspiration: (businessId: string) => void;
  /**
   * Loads the business's AI chats from the server (in admin preview its read-only copy), first importing chats an
   * older version kept in this browser; a demo business's first visit adds the sample chats.
   */
  loadChats: (businessId: string, demo: boolean) => void;
  /** Loads the chat list again (after a change the server refused). */
  reloadChats: () => void;
  newChat: () => void;
  /** Opens a chat, loading its messages when they aren't here yet. */
  openChat: (id: string) => void;
  /** Loads a saved chat's messages (again, after a failure). */
  loadChat: (id: string) => void;
  renameChat: (id: string, title: string) => void;
  deleteChat: (id: string) => void;
  /**
   * Adds messages to the open chat, starting a new chat if none is open, and saves them (`saved`: the server
   * already did — an AI answer from POST /api/ai-chat). Returns the chat id.
   */
  pushAi: (msgs: AiMsg[], opts?: { title?: L; chatId?: string; saved?: boolean }) => string;
  updateAiMsg: (msgId: string, patch: Partial<AiMsg>) => void;
  /** Resolves once everything sent for the chat so far has reached the server (its question is saved before the AI is asked). */
  flushChat: (id: string) => Promise<void>;
}

function freshData(): DemoData {
  const ids = ["mathanet", "qahwa", "tannour"] as const;
  const per = <T,>(f: (id: AccountId) => T) => Object.fromEntries(ids.map((id) => [id, f(id)])) as PerAccount<T>;
  return {
    accounts: structuredClone(mockAccounts),
    // Filled from the server by setGallery: nothing (and no sample photo) shows before it loads.
    photos: per(() => []),
    albums: per(() => []),
    competitors: per((id) => structuredClone(mockCompetitors[id])),
    // Filled by loadChats (from the server).
    chats: per(() => []),
    lastAnalysis: per(() => undefined),
  };
}

let uid = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${uid++}`;

export const useStore = create<State>()((set, get) => {
  const acc = () => get().activeAccountId;
  /** Updates the active account's chats (on screen; the API calls are sent by the actions). */
  const setChats = (f: (list: AiChat[]) => AiChat[], extra?: Partial<State>) => {
    set((s) => ({ ...extra, chats: { ...s.chats, [acc()]: f(s.chats[acc()] ?? []) } }));
  };
  const mapChat = (id: string, f: (chat: AiChat) => AiChat) => setChats((list) => list.map((c) => (c.id === id ? f(c) : c)));
  /** Sends a chat's change after the ones before it; a refused one is reported. Nothing is sent in admin preview. */
  const queueChat = (chatId: string, call: () => Promise<unknown>) => {
    if (get().readOnly) return;
    const next = (chatQueues.get(chatId) ?? Promise.resolve()).then(call).then(
      () => undefined,
      (error) => get().sync?.report(error),
    );
    chatQueues.set(chatId, next);
  };
  /** The admin preview reads the business's chats through the preview routes. */
  const previewOf = () => (get().readOnly ? (get().chatsOwner ?? undefined) : undefined);
  /** The server's chat list on screen: chats already open keep their messages; chats being saved or deleted here stay as they are. */
  const showChats = (list: AiChatSummaryDto[]) =>
    set((s) => {
      const mine = s.chats[acc()] ?? [];
      const fromServer: AiChat[] = list
        .filter((c) => !deletedChats.has(c.id))
        .map((c) => {
          const open = mine.find((m) => m.id === c.id && !m.load);
          return open ? { ...open, title: c.title } : { id: c.id, title: c.title, at: c.at, messages: [], load: "pending" };
        });
      const unsaved = mine.filter((m) => unsavedChats.has(m.id) && !list.some((c) => c.id === m.id));
      const chats = [...unsaved, ...fromServer].sort((a, b) => b.at.localeCompare(a.at));
      return { chats: { ...s.chats, [acc()]: chats }, activeChatId: chats.some((c) => c.id === s.activeChatId) ? s.activeChatId : null };
    });
  const mapPhotos = (ids: string[], f: (p: Photo) => Photo) =>
    set((s) => ({ photos: { ...s.photos, [acc()]: s.photos[acc()].map((p) => (ids.includes(p.id) ? f(p) : p)) } }));
  /** False (with the preview notice) when changes are off. */
  const canChange = () => {
    if (!get().readOnly) return true;
    get().sync?.blocked();
    return false;
  };
  /** Sends a change made on screen; when the API refuses it, says why and reloads the Gallery. */
  const send = <T,>(request: Promise<T>): Promise<T | null> =>
    request.catch((error) => {
      get().sync?.report(error);
      get().sync?.refetch();
      return null;
    });
  /** Server ids of the photos shown under `ids`. */
  const apiIds = (ids: string[]) => {
    const photos = get().photos[acc()];
    return ids.map((id) => apiId(photos.find((p) => p.id === id) ?? { id }));
  };
  /** Category albums (demo only) come from the sample data and aren't stored. */
  const isCategoryAlbum = (albumId: string | undefined) => !!albumId && !!get().albums[acc()].find((a) => a.id === albumId)?.category;
  const applyDraft = (draft: GalleryDraftDto) => {
    const ids = draft.photoIds.map(screenId);
    mapPhotos(ids, (p) =>
      p.status === "published"
        ? p
        : {
            ...p,
            status: "draft",
            draftId: draft.id,
            caption: { en: draft.captionEn || draft.captionAr, ar: draft.captionAr || draft.captionEn },
            hashtags: draft.hashtags,
            suggestedFor: draft.suggestedFor ?? undefined,
            captionVersions: draft.versions,
            aiPost: draft.origin === "ai_chat" || p.aiPost,
          },
    );
  };

  return {
    ...freshData(),
    lang: "en",
    activeAccountId: "mathanet",
    sheet: null,
    viewer: null,
    activeChatId: null,
    chatsOwner: null,
    composer: { text: "", photoIds: [] },
    inspiration: [],
    inspirationOwner: null,
    selecting: false,
    setSelecting: (selecting) => set({ selecting }),
    switchTick: 0,
    galleryLoaded: false,
    demo: false,
    readOnly: false,
    sync: null,
    setSyncHooks: (sync, readOnly) => set({ sync, readOnly }),
    setGallery: (dto) => {
      const { photos, albums } = hydrateGallery(dto, acc());
      set((s) => ({ galleryLoaded: true, demo: dto.demo, photos: { ...s.photos, [acc()]: photos }, albums: { ...s.albums, [acc()]: albums } }));
    },

    setLang: (lang) => set({ lang }),
    setBusiness: (id, profile) =>
      set((s) => ({ activeAccountId: id, accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...profile } : a)) })),
    openSheet: (sheet) => set({ sheet }),
    closeSheet: () => set({ sheet: null }),
    openViewer: (ids, index) => set({ viewer: { ids, index } }),
    openCompetitorViewer: (posts, index) => set({ viewer: { ids: posts.map((p) => p.key), index, competitor: posts } }),
    setViewerIndex: (index) => set((s) => (s.viewer ? { viewer: { ...s.viewer, index } } : {})),
    closeViewer: () => set({ viewer: null }),

    toggleFavorite: (ids, value) => {
      if (!canChange() || !ids.length) return;
      const next = value ?? !get().photos[acc()].find((p) => p.id === ids[0])?.favorite;
      mapPhotos(ids, (p) => ({ ...p, favorite: next }));
      void send(galleryApi.favorite(apiIds(ids), next));
    },
    deletePhotos: (ids) => {
      if (!canChange()) return [];
      const removed = get().photos[acc()].filter((p) => ids.includes(p.id));
      const serverIds = apiIds(ids);
      set((s) => ({
        photos: { ...s.photos, [acc()]: s.photos[acc()].filter((p) => !ids.includes(p.id)) },
        composer: { ...s.composer, photoIds: s.composer.photoIds.filter((id) => !ids.includes(id)) },
      }));
      void send(galleryApi.remove(serverIds));
      return removed;
    },
    restorePhotos: (photos) => {
      if (!canChange() || !photos.length) return;
      set((s) => ({
        photos: {
          ...s.photos,
          [acc()]: [...s.photos[acc()], ...photos].sort((a, b) => b.takenAt.localeCompare(a.takenAt)),
        },
      }));
      void send(galleryApi.restore(photos.map(apiId)));
    },
    createAlbum: async (name, photoIds = []) => {
      if (!canChange()) return null;
      const ids = photoIds.filter((id) => !isCategoryAlbum(id));
      const album = await send(galleryApi.createAlbum({ name, photoIds: ids.length ? apiIds(ids) : undefined }));
      if (!album) return null;
      set((s) => ({ albums: { ...s.albums, [acc()]: [...s.albums[acc()], { id: album.id, name: { en: album.name, ar: album.name } }] } }));
      if (ids.length) mapPhotos(ids, (p) => ({ ...p, albums: [...p.albums.filter((a) => a !== album.id), album.id] }));
      return album.id;
    },
    renameAlbum: (id, name) => {
      if (!canChange() || isCategoryAlbum(id)) return;
      set((s) => ({ albums: { ...s.albums, [acc()]: s.albums[acc()].map((a) => (a.id === id ? { ...a, name: { en: name, ar: name } } : a)) } }));
      void send(galleryApi.renameAlbum(id, name));
    },
    deleteAlbum: (id) => {
      if (!canChange() || isCategoryAlbum(id)) return undefined;
      const list = get().albums[acc()];
      const index = list.findIndex((a) => a.id === id);
      if (index < 0) return undefined;
      const photoIds = get().photos[acc()].filter((p) => p.albums.includes(id)).map((p) => p.id);
      set((s) => ({
        albums: { ...s.albums, [acc()]: list.filter((a) => a.id !== id) },
        photos: { ...s.photos, [acc()]: s.photos[acc()].map((p) => (p.albums.includes(id) ? { ...p, albums: p.albums.filter((a) => a !== id) } : p)) },
      }));
      void send(galleryApi.deleteAlbum(id));
      return { album: list[index], index, photoIds };
    },
    restoreAlbum: ({ album, index, photoIds }) => {
      if (!canChange()) return;
      // Put back as a new album in the same place, with the same photos (it gets a new id).
      const customBefore = get().albums[acc()].slice(0, index).filter((a) => !a.category).length;
      const present = photoIds.filter((id) => get().photos[acc()].some((p) => p.id === id));
      void send(galleryApi.createAlbum({ name: album.name.en, photoIds: present.length ? apiIds(present) : undefined, position: customBefore })).then((created) => {
        if (created) get().sync?.refetch();
      });
    },
    addToAlbum: (ids, albumId, moveFrom) => {
      if (!canChange() || isCategoryAlbum(albumId)) return;
      const from = moveFrom && !isCategoryAlbum(moveFrom) ? moveFrom : undefined;
      mapPhotos(ids, (p) => ({ ...p, albums: [...p.albums.filter((a) => a !== from && a !== albumId), albumId] }));
      void send(galleryApi.addToAlbum(albumId, apiIds(ids), from));
    },
    addUploaded: (uploaded) => {
      if (!uploaded.length) return;
      const { photos } = hydrateGallery({ demo: false, photos: uploaded, albums: [], drafts: [], hidden: [] }, acc());
      set((s) => ({ photos: { ...s.photos, [acc()]: [...photos, ...s.photos[acc()].filter((p) => !photos.some((u) => u.id === p.id))] } }));
    },
    addAiImage: (item) => {
      // Demo only: a sample photo with a look ("mathanet-07~2"); kept on the server like other sample photos.
      const base = get().photos[acc()].find((p) => p.sample && p.src === item.src && !p.look);
      const id = `${base?.id ?? item.src}~${item.look ?? 1}`;
      if (!get().photos[acc()].some((p) => p.id === id)) {
        const photo: Photo = { ...item, id, accountId: acc(), takenAt: new Date().toISOString(), status: "none", source: "ai", favorite: false, sample: true, albums: [] };
        set((s) => ({ photos: { ...s.photos, [acc()]: [photo, ...s.photos[acc()]] } }));
        // Any change to a sample photo creates the server row that keeps it; an unchanged favourite is the smallest one.
        if (!get().readOnly) void send(galleryApi.favorite([apiId(photo)], false));
      }
      return id;
    },
    saveDraft: async (input) => {
      if (!canChange()) return null;
      const draft = await send(
        galleryApi.createDraft({
          photoIds: apiIds(input.photoIds),
          caption: input.caption,
          hashtags: input.hashtags,
          suggestedFor: input.suggestedFor ?? null,
          versions: input.versions,
          origin: input.origin,
        }),
      );
      if (!draft) return null;
      applyDraft(draft);
      return draft.id;
    },
    updateDraft: async (draftId, patch) => {
      if (!canChange()) return false;
      const draft = await send(galleryApi.updateDraft(draftId, patch));
      if (!draft) return false;
      applyDraft(draft);
      return true;
    },
    updateCaption: async (ids, caption) => {
      const draftId = get().photos[acc()].find((p) => ids.includes(p.id) && p.draftId)?.draftId;
      if (!draftId || !canChange()) return false;
      mapPhotos(ids, (p) => ({ ...p, caption }));
      return get().updateDraft(draftId, { caption, hashtags: hashtagsIn(caption.en, caption.ar) });
    },

    setComposer: (patch) => set((s) => ({ composer: { ...s.composer, ...patch } })),
    toggleInspiration: (post) => {
      const saved = get().inspiration.some((p) => p.key === post.key);
      set((s) => ({
        inspiration: saved ? s.inspiration.filter((p) => p.key !== post.key) : [{ ...post, savedAt: new Date().toISOString() }, ...s.inspiration].slice(0, MAX_SAVED_INSPIRATION),
      }));
      writeSaved(get().inspirationOwner, get().inspiration);
      return !saved;
    },
    loadInspiration: (businessId) => {
      if (get().inspirationOwner !== businessId) set({ inspirationOwner: businessId, inspiration: readSaved(businessId) });
    },
    loadChats: (businessId, demo) => {
      if (get().chatsOwner === businessId) return;
      const account = acc();
      // Chats are loaded once the Gallery says whether this is a demo business; a chat started before
      // that (a quick tap on the start screen) is already being saved, stays open and is kept.
      set({ chatsOwner: businessId });
      void (async () => {
        try {
          const preview = previewOf();
          let list = await chatsApi.list(preview);
          if (!preview) {
            const local = readLocalChats(businessId);
            const seeds = (local ?? []).filter((c) => c.id.startsWith("seed-"));
            const own = (local ?? []).filter((c) => !c.id.startsWith("seed-"));
            let imported = own.length ? await chatsApi.import(own) : 0;
            // Real businesses never get the sample chats (they're dropped from an old local list too). A demo
            // business that had a local list keeps the sample chats it still had there; else it gets them fresh.
            if (demo && list.sampleDue) {
              const sample =
                local !== null
                  ? seeds
                  : shiftChats(seedChats({ account: get().accounts.find((a) => a.id === account)!, photos: initialPhotos[account], insights: mockInsights[account], competitors: mockCompetitors[account] }), NOW, new Date());
              imported += await chatsApi.import(sample, true);
            }
            if (local !== null) forgetLocalChats(businessId);
            if (imported) list = await chatsApi.list();
          }
          if (get().chatsOwner === businessId) showChats(list.chats);
        } catch (error) {
          get().sync?.report(error);
        }
      })();
    },
    reloadChats: () => {
      const owner = get().chatsOwner;
      if (!owner) return;
      chatsApi.list(previewOf()).then(
        (list) => get().chatsOwner === owner && showChats(list.chats),
        () => undefined,
      );
    },
    newChat: () => set({ activeChatId: null, composer: { text: "", photoIds: [] } }),
    openChat: (id) => {
      set({ activeChatId: id, composer: { text: "", photoIds: [] } });
      const load = (get().chats[acc()] ?? []).find((c) => c.id === id)?.load;
      if (load === "pending" || load === "failed") get().loadChat(id);
    },
    loadChat: (id) => {
      mapChat(id, (c) => ({ ...c, load: "loading" }));
      chatsApi.get(id, previewOf()).then(
        (dto) => mapChat(id, (c) => ({ ...c, title: dto.title, messages: readChatMessages(dto.messages), load: undefined })),
        () => mapChat(id, (c) => (c.load === "loading" ? { ...c, load: "failed" } : c)),
      );
    },
    renameChat: (id, title) => {
      if (!canChange()) return;
      mapChat(id, (c) => ({ ...c, title: { en: title, ar: title } }));
      queueChat(id, () =>
        chatsApi.rename(id, title).catch((error) => {
          get().reloadChats();
          throw error;
        }),
      );
    },
    deleteChat: (id) => {
      if (!canChange()) return;
      deletedChats.add(id);
      setChats(
        (list) => list.filter((c) => c.id !== id),
        get().activeChatId === id ? { activeChatId: null, composer: { text: "", photoIds: [] } } : undefined,
      );
      queueChat(id, () =>
        chatsApi.remove(id).catch((error) => {
          deletedChats.delete(id);
          get().reloadChats();
          throw error;
        }),
      );
    },
    pushAi: (msgs, opts) => {
      const s = get();
      const list = s.chats[acc()] ?? [];
      const existing = list.find((c) => c.id === (opts?.chatId ?? s.activeChatId));
      // A late answer for a chat deleted meanwhile is dropped.
      if (opts?.chatId && !existing) return opts.chatId;
      // Real time, not the demo clock: chats are saved and grouped by Today / Yesterday / Earlier.
      const at = new Date().toISOString();
      const chat: AiChat = existing
        ? { ...existing, at, messages: [...existing.messages, ...msgs] }
        : { id: nextId("chat"), title: opts?.title ?? { en: "New chat", ar: "محادثة جديدة" }, at, messages: msgs };
      // Most recent chat first, like ChatGPT. Late answers for a chat that's no longer open don't switch to it.
      setChats(() => [chat, ...list.filter((c) => c.id !== chat.id)], { activeChatId: opts?.chatId ? s.activeChatId : chat.id });
      if (!opts?.saved) {
        if (existing) queueChat(chat.id, () => chatsApi.append(chat.id, msgs));
        else if (!s.readOnly) {
          unsavedChats.add(chat.id);
          queueChat(chat.id, () => chatsApi.create(chat).finally(() => unsavedChats.delete(chat.id)));
        }
      }
      return chat.id;
    },
    updateAiMsg: (msgId, patch) => {
      const chat = (get().chats[acc()] ?? []).find((c) => c.messages.some((m) => m.id === msgId));
      if (!chat) return;
      const msg = { ...chat.messages.find((m) => m.id === msgId)!, ...patch } as AiMsg;
      mapChat(chat.id, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === msgId ? msg : m)) }));
      queueChat(chat.id, () => chatsApi.update(chat.id, msg));
    },
    flushChat: (id) => chatQueues.get(id) ?? Promise.resolve(),
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
