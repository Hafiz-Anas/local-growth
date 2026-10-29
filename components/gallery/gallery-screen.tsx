"use client";

import { ChevronLeft, EyeOff, FolderPlus, Heart, ImagePlus, Images, MoreHorizontal, PencilLine, Plus, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Btn, EmptyState, IconBtn, Segmented, Skel } from "@/components/gallery/kit";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/gallery/dropdown-menu";
import { useFeature } from "@/components/providers/active-client-provider";
import { useBackHandler } from "@/lib/gallery/back";
import { date, daysFromNow, num } from "@/lib/gallery/format";
import { ErrorState } from "@/components/shared/states";
import { useT } from "@/lib/gallery/hooks";
import { useGalleryQuery } from "./gallery-sync";
import { useAlbums, usePhotos, useStore } from "@/lib/gallery/store";
import { cn } from "@/lib/gallery/utils";
import type { Lang, Photo } from "@/mock-data/gallery/types";
import { SMART_ALBUMS, smartAlbums } from "./albums";
import { PhotoImage } from "./photo-image";
import { PhotoTile } from "./photo-tile";
import { usePhotoActions } from "./use-photo-actions";
import { CLIENT_FIXED_START } from "@/components/layout/sidebar";

type Tab = "library" | "albums";

export function GalleryScreen() {
  const { t, l, lang } = useT();
  const photos = usePhotos();
  const customAlbums = useAlbums();
  const gallery = useGalleryQuery();
  const loading = !useStore((s) => s.galleryLoaded);
  const selecting = useStore((s) => s.selecting);
  const setSelecting = useStore((s) => s.setSelecting);
  const openSheet = useStore((s) => s.openSheet);
  const [tab, setTab] = useState<Tab>("library");
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const smart = albumId ? SMART_ALBUMS.find((a) => a.id === albumId) : undefined;
  const custom = albumId ? customAlbums.find((a) => a.id === albumId) : undefined;
  const albumName = smart ? t(smart.key) : custom ? l(custom.name) : "";
  const visible = useMemo(() => {
    if (!albumId) return photos;
    const smart = SMART_ALBUMS.find((a) => a.id === albumId);
    return smart ? photos.filter(smart.filter) : photos.filter((p) => p.albums.includes(albumId));
  }, [albumId, photos]);

  const exitSelect = useCallback(() => {
    setSelecting(false);
    setSelected([]);
  }, [setSelecting]);
  useEffect(() => () => setSelecting(false), [setSelecting]);

  const closeAlbum = () => (setAlbumId(null), exitSelect());
  useBackHandler(!!albumId, closeAlbum);

  const toggle = useCallback((id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])), []);
  const open = useCallback(
    (id: string) => {
      const ids = visible.map((p) => p.id);
      useStore.getState().openViewer(ids, ids.indexOf(id));
    },
    [visible],
  );

  const removeAlbum = () => {
    if (!custom) return;
    const removed = useStore.getState().deleteAlbum(custom.id);
    closeAlbum();
    if (removed)
      toast.success(t("albumDeleted", { album: l(custom.name) }), { action: { label: t("undo"), onClick: () => useStore.getState().restoreAlbum(removed) } });
  };

  const showGrid = tab === "library" || albumId;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-1 pb-3 lg:px-0 lg:pt-4">
        {albumId ? (
          <>
            <IconBtn label={t("back")} onClick={closeAlbum} className="-ms-2">
              <ChevronLeft className="rtl:rotate-180" />
            </IconBtn>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[22px] leading-tight font-bold tracking-tight">{albumName}</h1>
              <p className="text-xs text-ge-muted-foreground">{t("photosCount", { n: num(visible.length, lang) })}</p>
            </div>
          </>
        ) : (
          <Segmented
            label={t("gallery")}
            value={tab}
            onChange={(v) => (setTab(v), exitSelect())}
            options={[
              { value: "library", label: t("library") },
              { value: "albums", label: t("albums") },
            ]}
            className="w-full max-w-[260px]"
          />
        )}
        {!albumId && <div className="flex-1" />}
        {showGrid && visible.length > 0 && (
          <Btn
            variant={selecting ? "primary" : "secondary"}
            size="sm"
            className="rounded-full"
            onClick={() => (selecting ? exitSelect() : setSelecting(true))}
          >
            {selecting ? t("cancel") : t("select")}
          </Btn>
        )}
        {/* Upload adds to the library, so it lives on the top level; an empty library shows it in the empty state instead. */}
        {!selecting && !albumId && photos.length > 0 && (
          <Btn variant="secondary" size="sm" className="rounded-full" icon={<ImagePlus />} onClick={() => openSheet({ type: "upload" })}>
            <span className="max-sm:sr-only">{t("upload")}</span>
          </Btn>
        )}
        {/* Category albums (demo samples) can't be renamed or deleted. */}
        {custom && !custom.category && !selecting && (
          <DropdownMenu>
            <DropdownMenuTrigger aria-label={t("albumOptions")} className="grid size-9 shrink-0 place-items-center rounded-full bg-ge-secondary hover:bg-ge-muted">
              <MoreHorizontal className="size-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => openSheet({ type: "albumName", albumId: custom.id })}>
                <PencilLine /> {t("renameAlbum")}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={removeAlbum}>
                <Trash2 /> {t("deleteAlbum")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {loading && gallery.isError ? (
        <div className="px-4 lg:px-0">
          <ErrorState error={gallery.error} onRetry={() => void gallery.refetch()} />
        </div>
      ) : loading ? (
        <GridSkeleton />
      ) : showGrid ? (
        visible.length === 0 ? (
          albumId ? (
            <EmptyState icon={<Images />} title={t("emptyAlbumTitle")} body={custom ? t("emptyCustomAlbumBody") : t("emptyAlbumBody")} />
          ) : (
            <EmptyState
              icon={<ImagePlus />}
              title={t("emptyLibraryTitle")}
              body={t("emptyLibraryBody")}
              action={<Btn onClick={() => openSheet({ type: "upload" })}>{t("uploadPhotos")}</Btn>}
            />
          )
        ) : albumId ? (
          <Grid photos={visible} selecting={selecting} selected={selected} onOpen={open} onToggle={toggle} />
        ) : (
          <GroupedGrid photos={visible} lang={lang} selecting={selecting} selected={selected} onOpen={open} onToggle={toggle} />
        )
      ) : (
        <AlbumsView photos={photos} onOpen={setAlbumId} />
      )}

      {selecting && (
        <SelectionBar ids={selected} fromAlbumId={custom?.id} onDone={exitSelect} onSelectAll={() => setSelected(visible.map((p) => p.id))} />
      )}
    </div>
  );
}

/* ---------- Grids ---------- */

type GridProps = { photos: Photo[]; selecting: boolean; selected: string[]; onOpen: (id: string) => void; onToggle: (id: string) => void };

function Grid({ photos, selecting, selected, onOpen, onToggle, offset = 0 }: GridProps & { offset?: number }) {
  return (
    <div className="grid grid-cols-3 gap-[2px] sm:grid-cols-4 lg:grid-cols-5 lg:gap-1">
      {photos.map((p, i) => (
        <PhotoTile key={p.id} photo={p} selecting={selecting} selected={selected.includes(p.id)} onOpen={onOpen} onToggle={onToggle} priority={offset + i < 9} />
      ))}
    </div>
  );
}

function bucket(iso: string, lang: Lang, t: ReturnType<typeof useT>["t"]) {
  const d = daysFromNow(iso);
  if (d >= -6) return t("thisWeek");
  if (d >= -13) return t("lastWeek");
  return date(iso, lang, { month: "long", year: "numeric" });
}

function GroupedGrid({ photos, lang, ...rest }: GridProps & { lang: Lang }) {
  const { t } = useT();
  const groups = useMemo(() => {
    const out: { title: string; photos: Photo[] }[] = [];
    for (const p of photos) {
      const title = bucket(p.takenAt, lang, t);
      const last = out[out.length - 1];
      if (last?.title === title) last.photos.push(p);
      else out.push({ title, photos: [p] });
    }
    return out;
  }, [photos, lang, t]);

  let offset = 0;
  return (
    <div className="space-y-5">
      {groups.map((g) => {
        const start = offset;
        offset += g.photos.length;
        return (
          <section key={g.title} aria-label={g.title}>
            <h2 className="px-4 pb-2 text-[15px] font-semibold lg:px-0">{g.title}</h2>
            <Grid photos={g.photos} offset={start} {...rest} />
          </section>
        );
      })}
    </div>
  );
}

function GridSkeleton() {
  return (
    <div aria-busy className="space-y-5">
      <Skel className="mx-4 h-4 w-24 lg:mx-0" />
      <div className="grid grid-cols-3 gap-[2px] sm:grid-cols-4 lg:grid-cols-5 lg:gap-1">
        {Array.from({ length: 15 }, (_, i) => (
          <Skel key={i} className="aspect-square rounded-none" />
        ))}
      </div>
    </div>
  );
}

/* ---------- Albums ---------- */

type AlbumCardData = { id: string; name: string; icon: typeof Images; items: Photo[] };

function AlbumsView({ photos, onOpen }: { photos: Photo[]; onOpen: (id: string) => void }) {
  const { t, l, lang } = useT();
  const custom = useAlbums();
  const openSheet = useStore((s) => s.openSheet);
  const mine: AlbumCardData[] = custom.map((a) => ({ id: a.id, name: l(a.name), icon: Images, items: photos.filter((p) => p.albums.includes(a.id)) }));
  const demo = useStore((s) => s.demo);
  const smart: AlbumCardData[] = smartAlbums(demo).map((a) => ({ id: a.id, name: t(a.key), icon: a.icon, items: photos.filter(a.filter) }));
  const grid = "grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 lg:grid-cols-4";
  const card = (a: AlbumCardData) => (
    <button key={a.id} type="button" onClick={() => onOpen(a.id)} className="group min-w-0 rounded-xl text-start">
      <span className="relative block aspect-square overflow-hidden rounded-xl bg-ge-muted">
        {a.items[0] ? (
          <PhotoImage photo={a.items[0]} sizes="(min-width: 1024px) 220px, 45vw" className="transition-transform duration-300 group-hover:scale-[1.03]" />
        ) : (
          <span className="grid size-full place-items-center text-ge-muted-foreground">
            <a.icon className="size-9" strokeWidth={1.5} />
          </span>
        )}
      </span>
      <span className="mt-1.5 block truncate text-sm font-medium">{a.name}</span>
      <span className="block text-[13px] text-ge-muted-foreground">{num(a.items.length, lang)}</span>
    </button>
  );
  return (
    <div className="space-y-7 px-4 lg:px-0">
      <section>
        <h2 className="mb-3 text-[17px] font-semibold">{t("myAlbums")}</h2>
        <div className={grid}>
          {mine.map(card)}
          <button type="button" onClick={() => openSheet({ type: "albumName" })} className="group min-w-0 rounded-xl text-start">
            <span className="grid aspect-square place-items-center rounded-xl border-2 border-dashed border-ge-foreground/15 text-ge-muted-foreground transition-colors group-hover:bg-ge-muted">
              <Plus className="size-8" strokeWidth={1.5} />
            </span>
            <span className="mt-1.5 block truncate text-sm font-medium">{t("newAlbum")}</span>
          </button>
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-[17px] font-semibold">{t("collections")}</h2>
        <div className={grid}>{smart.map(card)}</div>
      </section>
    </div>
  );
}

/* ---------- Select mode toolbar ---------- */

function SelectionBar({ ids, fromAlbumId, onDone, onSelectAll }: { ids: string[]; fromAlbumId?: string; onDone: () => void; onSelectAll: () => void }) {
  const { t, lang } = useT();
  const actions = usePhotoActions();
  const photos = usePhotos();
  // With the AI chat switched off there is no "Create post with AI" (removed, never grayed out).
  const ai = useFeature("aiChat");
  const none = ids.length === 0;
  const allFavorite = !none && ids.every((id) => photos.find((p) => p.id === id)?.favorite);
  // Instagram posts are only hidden here: nothing changes on Instagram, and the button says so.
  const hideOnly = !none && ids.every((id) => photos.find((p) => p.id === id)?.source === "instagram");
  const act = (f: () => void, done = true) => () => {
    f();
    if (done) onDone();
  };
  return (
    <div className={`fixed inset-x-0 bottom-[calc(52px+env(safe-area-inset-bottom))] z-30 px-3 pb-2 lg:bottom-5 lg:flex lg:justify-center lg:px-8 ${CLIENT_FIXED_START}`}>
      <div className="flex items-center gap-1 rounded-2xl border bg-ge-elevated/95 p-1.5 shadow-[0_8px_30px_-10px_rgb(0_0_0/0.3)] backdrop-blur-xl lg:w-[560px]">
        <button type="button" onClick={onSelectAll} className="min-w-0 flex-1 truncate rounded-xl px-2 text-start text-[13px] font-semibold">
          {none ? t("selectPhotos") : t("selectedCount", { n: num(ids.length, lang) })}
        </button>
        {ai && (
          <BarBtn label={t("createWithAi")} disabled={none} onClick={act(() => actions.createWithAi(ids))} className="text-ge-brand-ink">
            <Sparkles />
          </BarBtn>
        )}
        <BarBtn label={fromAlbumId ? t("addOrMove") : t("addToAlbum")} disabled={none} onClick={act(() => actions.addToAlbum(ids, fromAlbumId))}>
          <FolderPlus />
        </BarBtn>
        <BarBtn label={allFavorite ? t("unfavorite") : t("favorite")} disabled={none} onClick={act(() => actions.favorite(ids, !allFavorite))}>
          <Heart className={cn(allFavorite && "fill-current")} />
        </BarBtn>
        <BarBtn label={hideOnly ? t("hideFromGallery") : t("delete")} disabled={none} onClick={act(() => actions.remove(ids))} className="text-ge-destructive">
          {hideOnly ? <EyeOff /> : <Trash2 />}
        </BarBtn>
      </div>
    </div>
  );
}

function BarBtn({ label, children, className, ...props }: { label: string; children: ReactNode; className?: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn("grid size-10 shrink-0 place-items-center rounded-xl hover:bg-ge-muted disabled:opacity-35 [&_svg]:size-[22px]", className)}
      {...props}
    >
      {children}
    </button>
  );
}
