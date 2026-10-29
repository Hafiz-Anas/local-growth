"use client";

import { Dialog } from "@base-ui/react/dialog";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { Bookmark, CalendarClock, ChevronLeft, ChevronRight, CircleCheck, EyeOff, FolderPlus, Heart, MessageCircle, PencilLine, Sparkles, SquareArrowOutUpRight, Trash2, TrendingUp, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useOpenAi } from "@/components/ai-chat/use-open-ai";
import { Avatar } from "@/components/gallery/kit";
import { useFeature } from "@/components/providers/active-client-provider";
import { MediaPlaceholder } from "@/components/shared/media";
import type { CompetitorPostRef } from "@/lib/gallery/competitor-posts";
import { compact, date, num, time, when } from "@/lib/gallery/format";
import { useIsDesktop, useT } from "@/lib/gallery/hooks";
import { useAccount, usePhotos, useStore } from "@/lib/gallery/store";
import { cn } from "@/lib/gallery/utils";
import { findCategory } from "@/mock-data/gallery/categories";
import type { Photo } from "@/mock-data/gallery/types";
import { PhotoImage, isPost } from "./photo-image";
import { SourceBadge } from "./photo-tile";
import { CaptionText } from "./post-preview";
import { usePhotoActions } from "./use-photo-actions";

/**
 * Photo viewer. A plain photo opens full screen like the Photos app; a ready post opens like an Instagram post,
 * with its caption and hashtags under the photo. Swipe sideways between items, swipe down to close.
 * A competitor's posts (their profile, Competitors → Inspiration) open here too, as Instagram posts with
 * their own two actions: Create a similar post and Save as inspiration (never albums, Favourites or Delete).
 */
export function PhotoViewer() {
  const viewer = useStore((s) => s.viewer);
  const close = useStore((s) => s.closeViewer);
  return (
    // Non-modal so sheets opened from the viewer (Open post, Add to album…) can sit on top of it.
    <Dialog.Root open={!!viewer} onOpenChange={(open) => !open && close()} modal={false} disablePointerDismissal>
      <AnimatePresence>{viewer && <ViewerContent key="viewer" />}</AnimatePresence>
    </Dialog.Root>
  );
}

function ViewerContent() {
  const { t, l, lang, dir } = useT();
  const isDesktop = useIsDesktop();
  // Keep the last state while the viewer animates closed (the store is already null by then).
  const current = useStore((s) => s.viewer);
  const [last, setLast] = useState(current);
  if (current && current !== last) setLast(current);
  const viewer = current ?? last!;
  const close = useStore((s) => s.closeViewer);
  const sheetOpen = useStore((s) => s.sheet !== null);
  const photos = usePhotos();
  const accountId = useStore((s) => s.activeAccountId);
  const actions = usePhotoActions();
  // With the AI chat switched off there is no "Create post with AI" (removed, never grayed out).
  const ai = useFeature("aiChat");
  const popupRef = useRef<HTMLDivElement>(null);
  const [direction, setDirection] = useState(0);
  const [chrome, setChrome] = useState(true);

  const competitor = viewer.competitor;
  const items = competitor ? [] : viewer.ids.map((id) => photos.find((p) => p.id === id)).filter((p) => p !== undefined);
  const count = competitor ? competitor.length : items.length;
  const index = Math.min(viewer.index, count - 1);
  const photo = items[index];
  const theirs = competitor?.[index];

  // If the photo was deleted and nothing is left, close.
  useEffect(() => {
    if (!photo && !theirs) close();
  }, [photo, theirs, close]);

  const go = (step: number) => {
    const next = index + step;
    if (next < 0 || next >= count) return;
    setDirection(step);
    if (competitor) useStore.getState().setViewerIndex(next);
    else
      useStore.getState().openViewer(
        items.map((p) => p.id),
        next,
      );
  };

  // The page behind never scrolls while the viewer is open (the document is the app's scroller).
  useEffect(() => {
    const html = document.documentElement;
    const before = { overflow: html.style.overflow, overscroll: html.style.overscrollBehavior };
    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    return () => {
      html.style.overflow = before.overflow;
      html.style.overscrollBehavior = before.overscroll;
    };
  }, []);

  // Capture phase: the dialog stops arrow keys from bubbling to window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useStore.getState().sheet || (e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]"))) return;
      if (e.key === "ArrowRight") go(dir === "rtl" ? -1 : 1);
      if (e.key === "ArrowLeft") go(dir === "rtl" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  if (!photo && !theirs) return null;

  const post = !photo || isPost(photo);
  const rtl = dir === "rtl" ? -1 : 1;
  const onDragEnd = (_: unknown, info: PanInfo) => {
    const { x, y } = info.offset;
    if (y > 110 && Math.abs(y) > Math.abs(x)) return close();
    if (x * rtl < -70 || info.velocity.x * rtl < -500) go(1);
    else if (x * rtl > 70 || info.velocity.x * rtl > 500) go(-1);
  };
  const drag = {
    drag: true,
    dragDirectionLock: true,
    dragSnapToOrigin: true,
    dragElastic: 0.6,
    onDragEnd,
  } as const;

  const removeCurrent = () => {
    if (!photo) return;
    const ids = items.map((p) => p.id).filter((id) => id !== photo.id);
    actions.remove([photo.id]);
    if (ids.length) useStore.getState().openViewer(ids, Math.min(index, ids.length - 1));
    else close();
  };

  const category = findCategory(accountId, photo?.category);
  const title = theirs ? t("competitorPost") : post ? t("readyPost") : l(photo!.dish);
  const subtitle = theirs
    ? `@${theirs.handle}`
    : post
      ? l(photo!.dish)
      : `${category ? `${l(category.name)} • ` : ""}${date(photo!.takenAt, lang, { day: "numeric", month: "long" })} • ${time(photo!.takenAt, lang)}`;
  const showChrome = chrome || post;
  const tone = post ? "text-ge-foreground" : "text-white";
  const subtle = post ? "text-ge-muted-foreground" : "text-white/60";
  const hover = post ? "hover:bg-ge-muted" : "hover:bg-white/10";

  return (
    <Dialog.Portal keepMounted>
      <Dialog.Popup
        ref={popupRef}
        initialFocus={popupRef}
        aria-label={theirs ? t("postBy", { handle: theirs.handle }) : l(photo!.dish)}
        className={cn("ge fixed inset-0 z-[60] flex flex-col outline-none transition-colors duration-200", post ? "bg-ge-background" : "bg-black", tone)}
        render={<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />}
      >
        {/* Top bar */}
        <div className={cn("relative z-10 pt-safe transition-opacity", !showChrome && "pointer-events-none opacity-0", post && "border-b")}>
          <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-2">
            <Dialog.Close aria-label={t("close")} className={cn("grid size-10 place-items-center rounded-full", hover)}>
              <X className="size-6" />
            </Dialog.Close>
            <div className="min-w-0 flex-1 text-center">
              <Dialog.Title className="truncate text-[15px] font-semibold">{title}</Dialog.Title>
              <p className={cn("truncate text-xs", subtle)} dir={theirs ? "ltr" : undefined}>
                {subtitle}
              </p>
            </div>
            <span className={cn("w-10 text-center text-xs tabular-nums", subtle)}>
              {num(index + 1, lang)}/{num(count, lang)}
            </span>
          </div>
        </div>

        {/* Item: swipes in from the side */}
        <div className="relative min-h-0 flex-1 overflow-hidden" onClick={() => !post && setChrome((c) => !c)}>
          <AnimatePresence initial={false} custom={direction} mode="popLayout">
            <motion.div
              key={theirs?.key ?? photo!.id}
              custom={direction}
              variants={{
                enter: (d: number) => ({ x: `${d * rtl * 100}%`, opacity: 0.4 }),
                center: { x: 0, opacity: 1 },
                exit: (d: number) => ({ x: `${-d * rtl * 100}%`, opacity: 0.4 }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: "spring", damping: 34, stiffness: 320 }}
              className="absolute inset-0"
            >
              {theirs ? (
                <CompetitorPostBody item={theirs} drag={drag} sheetOpen={sheetOpen} />
              ) : post ? (
                <PostBody photo={photo!} drag={drag} sheetOpen={sheetOpen} />
              ) : (
                <motion.div {...drag} drag={!sheetOpen} className="absolute inset-0 touch-none">
                  <PhotoImage photo={photo!} full alt={l(photo!.dish)} sizes="100vw" priority className="pointer-events-none object-contain select-none" draggable={false} />
                  <SourceBadge photo={photo!} labeled className="absolute start-3 top-3" />
                </motion.div>
              )}
            </motion.div>
          </AnimatePresence>
          {isDesktop && (
            <>
              <NavArrow side="start" label={t("previous")} disabled={index === 0} onClick={() => go(-1)} post={post} />
              <NavArrow side="end" label={t("next")} disabled={index === count - 1} onClick={() => go(1)} post={post} />
            </>
          )}
        </div>

        {/* Actions. Scheduling only happens from a ready post's preview (Open post), never on a plain photo. */}
        <div className={cn("relative z-10 pb-safe transition-opacity", !showChrome && "pointer-events-none opacity-0", post && "border-t", theirs && "lg:hidden")}>
          {theirs ? (
            <CompetitorActions item={theirs} />
          ) : (
            <>
              <div className="mx-auto mt-3 flex max-w-xl justify-center px-4">
                {post ? (
                  <button
                    type="button"
                    onClick={() => actions.openPost(photo!.id)}
                    className="inline-flex h-11 items-center gap-2 rounded-full bg-ge-brand px-6 text-[15px] font-semibold text-ge-primary-foreground shadow-lg transition-transform active:scale-[0.97]"
                  >
                    <SquareArrowOutUpRight className="size-[18px]" />
                    {t("openPost")}
                  </button>
                ) : ai ? (
                  <button
                    type="button"
                    onClick={() => actions.createWithAi([photo!.id])}
                    className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[15px] font-semibold text-black shadow-lg transition-transform hover:bg-white/90 active:scale-[0.97]"
                  >
                    <Sparkles className="size-[18px] text-primary" />
                    {t("createWithAi")}
                  </button>
                ) : null}
              </div>
              <div className="mx-auto mt-2 grid max-w-md grid-cols-3 px-2 pb-2">
                <Action icon={<FolderPlus />} label={t("addToAlbum")} onClick={() => actions.addToAlbum([photo!.id])} post={post} />
                <Action
                  icon={<Heart className={cn(photo!.favorite && (post ? "fill-current text-ge-bad" : "fill-white"))} />}
                  label={photo!.favorite ? t("unfavorite") : t("favorite")}
                  pressed={photo!.favorite}
                  onClick={() => actions.favorite([photo!.id], !photo!.favorite)}
                  post={post}
                />
                {/* Instagram posts are only hidden from the Gallery: nothing changes on Instagram. */}
                {photo!.source === "instagram" ? (
                  <Action icon={<EyeOff />} label={t("hideFromGallery")} onClick={removeCurrent} post={post} />
                ) : (
                  <Action icon={<Trash2 />} label={t("delete")} onClick={removeCurrent} post={post} />
                )}
              </div>
            </>
          )}
        </div>
      </Dialog.Popup>
    </Dialog.Portal>
  );
}

/** A ready post, laid out like Instagram: account, photo, status, then caption and hashtags. */
function PostBody({ photo, drag, sheetOpen }: { photo: Photo; drag: Record<string, unknown>; sheetOpen: boolean }) {
  const { t, l, lang } = useT();
  const account = useAccount();
  const openSheet = useStore((s) => s.openSheet);
  const m = photo.metrics;
  return (
    <div className="absolute inset-0 overflow-y-auto overscroll-contain">
      <article className="mx-auto w-full max-w-[470px] pb-4">
        <header className="flex items-center gap-2.5 px-3 py-2.5">
          <Avatar src={account.avatar} alt={account.handle} size={32} />
          <p className="min-w-0 flex-1 truncate text-[13.5px] font-semibold" dir="ltr">
            {account.handle}
          </p>
          <PostStatus photo={photo} />
        </header>
        <motion.div {...drag} drag={!sheetOpen} className="relative aspect-square touch-none bg-ge-muted">
          <PhotoImage photo={photo} full alt={l(photo.dish)} sizes="(min-width: 640px) 470px, 100vw" priority className="pointer-events-none select-none" draggable={false} />
          <SourceBadge photo={photo} labeled className="absolute start-2.5 top-2.5" />
        </motion.div>
        {photo.status === "published" && m && (
          <div className="flex items-center gap-4 px-3 pt-3 text-sm">
            <Stat icon={<Heart className="size-4" />} label={t("likes")} value={compact(m.likes, lang)} />
            <Stat icon={<MessageCircle className="size-4" />} label={t("comments")} value={compact(m.comments, lang)} />
            <Stat icon={<TrendingUp className="size-4" />} label={t("reach")} value={compact(m.reach, lang)} />
            <button type="button" onClick={() => openSheet({ type: "performance", photoId: photo.id })} className="ms-auto rounded-full px-1 font-semibold text-ge-brand-ink hover:underline">
              {t("viewPerformance")}
            </button>
          </div>
        )}
        <p className="px-3 pt-2.5 text-[14.5px] leading-snug whitespace-pre-line" dir="auto">
          <bdi className="font-semibold">{account.handle}</bdi> <CaptionText text={l(photo.caption)} />
        </p>
      </article>
    </div>
  );
}

/**
 * A competitor's post, fitted to the screen (nothing scrolls but a long caption). Phone: the picture,
 * then their account, likes, comments and date, and the caption on 2 lines with "more" (expanding in its
 * own scroll area); the actions stay pinned in the viewer's bottom bar. Desktop: Instagram's desktop post,
 * the picture on the left and a panel with the account, a scrolling caption + stats and the actions.
 */
function CompetitorPostBody({ item, drag, sheetOpen }: { item: CompetitorPostRef; drag: Record<string, unknown>; sheetOpen: boolean }) {
  const { t, lang } = useT();
  const p = item.post;
  const [expanded, setExpanded] = useState(false);
  const caption = p.caption?.trim() ?? "";
  // "… more" only when the 2 lines actually cut the caption off (measured, so it follows width and language).
  const captionRef = useRef<HTMLParagraphElement>(null);
  const [clamped, setClamped] = useState(false);
  useEffect(() => {
    const el = captionRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setClamped(el.scrollHeight > el.clientHeight + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, [caption]);
  const long = expanded || clamped;
  return (
    <div className="absolute inset-0 flex flex-col [container-type:size] lg:items-center lg:justify-center lg:px-20 lg:py-6" data-testid="competitor-post">
      <article className="flex min-h-0 flex-1 flex-col lg:h-[min(100cqh,calc(100cqw-340px),760px)] lg:flex-none lg:flex-row lg:overflow-hidden lg:rounded-xl lg:border lg:bg-ge-background">
        {/* The picture: as big as fits, always square. */}
        <div className="relative min-h-0 flex-1 [container-type:size] lg:aspect-square lg:h-full lg:flex-none">
          <motion.div {...drag} drag={!sheetOpen} className="absolute inset-0 m-auto aspect-square size-[min(100cqw,100cqh)] touch-none" data-testid="competitor-post-image">
            <MediaPlaceholder
              tone={p.tone}
              icon={p.icon}
              src={p.mediaUrl}
              alt={t("postBy", { handle: item.handle })}
              className="pointer-events-none absolute inset-0 select-none"
              iconClassName="size-1/5"
            />
          </motion.div>
        </div>

        <div className="flex shrink-0 flex-col lg:min-h-0 lg:w-[340px] lg:shrink-0 lg:border-s">
          <header className="flex items-center gap-2.5 px-3 pt-2.5 pb-1 lg:border-b lg:py-3">
            <Avatar src={item.avatarUrl ?? undefined} alt={item.handle} size={32} />
            <div className="min-w-0 flex-1 leading-tight">
              {/* Isolated, so in Arabic they sit next to the avatar like the rest of the row. */}
              <p className="truncate text-[13.5px] font-semibold">
                <bdi dir="ltr">{item.handle}</bdi>
              </p>
              {item.name !== item.handle && (
                <p className="truncate text-[11.5px] text-ge-muted-foreground">
                  <bdi>{item.name}</bdi>
                </p>
              )}
            </div>
            {p.permalink && (
              <a href={p.permalink} target="_blank" rel="noreferrer" className="shrink-0 rounded-full px-1 text-[12.5px] font-semibold text-ge-brand-ink hover:underline">
                {t("viewOnInstagram")}
              </a>
            )}
          </header>

          {/* Phone: stats, then the caption. Desktop: the caption, then the stats, scrolling between header and actions. */}
          <div className="flex flex-col lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain">
            <div className="flex items-center gap-4 px-3 pt-1.5 text-sm lg:order-2 lg:mt-auto lg:border-t lg:py-3">
              <Stat icon={<Heart className="size-4" />} label={t("likes")} value={compact(p.likes, lang)} />
              <Stat icon={<MessageCircle className="size-4 rtl:-scale-x-100" />} label={t("comments")} value={compact(p.comments, lang)} />
              {p.postedAt && (
                <time dateTime={p.postedAt} className="ms-auto text-[12.5px] text-ge-muted-foreground">
                  {date(p.postedAt, lang, { day: "numeric", month: "long", year: "numeric" })}
                </time>
              )}
            </div>
            {caption && (
              <div
                className={cn("px-3 pt-1.5 pb-2 lg:order-1 lg:py-3", expanded && "max-h-[30dvh] overflow-y-auto overscroll-contain lg:max-h-none lg:overflow-visible")}
                data-testid="competitor-caption"
              >
                <p ref={captionRef} className={cn("text-[14.5px] leading-snug whitespace-pre-line lg:line-clamp-none", !expanded && "line-clamp-2")} dir="auto">
                  <bdi className="font-semibold">{item.handle}</bdi> <CaptionText text={caption} />
                </p>
                {long && (
                  <button type="button" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded} className="text-[13.5px] text-ge-muted-foreground lg:hidden">
                    {expanded ? t("captionLess") : t("captionMore")}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="hidden border-t lg:block">
            <CompetitorActions item={item} />
          </div>
        </div>
      </article>
    </div>
  );
}

/**
 * The competitor viewer's actions, as an action row like the Gallery viewer's: the AI chat with this post
 * as a reference, and Save as inspiration (Saved while it's in the Inspiration tab).
 */
function CompetitorActions({ item }: { item: CompetitorPostRef }) {
  const { t } = useT();
  const ai = useFeature("aiChat");
  const canSave = useFeature("competitors.inspiration");
  const saved = useStore((s) => s.inspiration.some((p) => p.key === item.key));
  const openAi = useOpenAi();
  const toggle = () => toast.success(useStore.getState().toggleInspiration(item) ? t("savedToInspiration") : t("removedFromInspiration"));
  if (!ai && !canSave) return null;
  return (
    <div className={cn("mx-auto mt-2 grid max-w-md px-2 pb-2", ai && canSave ? "grid-cols-2" : "grid-cols-1")} data-testid="competitor-actions">
      {ai && <Action icon={<Sparkles />} label={t("createSimilar")} onClick={() => openAi(undefined, item)} post />}
      {canSave && <Action icon={<Bookmark className={cn(saved && "fill-current")} />} label={saved ? t("savedInspiration") : t("saveInspiration")} pressed={saved} onClick={toggle} post />}
    </div>
  );
}

export function PostStatus({ photo }: { photo: Photo }) {
  const { t, lang } = useT();
  const s =
    photo.status === "published"
      ? { icon: <CircleCheck />, text: photo.publishedAt ? t("publishedOn", { when: when(photo.publishedAt, lang) }) : t("published") }
      : photo.status === "scheduled"
        ? { icon: <CalendarClock />, text: photo.scheduledFor ? when(photo.scheduledFor, lang) : t("scheduled") }
        : { icon: <PencilLine />, text: t("savedPost") };
  return (
    <span
      className={cn(
        "inline-flex max-w-[60%] items-center gap-1 truncate rounded-full px-2.5 py-1 text-[12px] font-semibold [&_svg]:size-3.5 [&_svg]:shrink-0",
        photo.status === "scheduled" ? "bg-ge-brand-soft text-ge-brand-ink" : "bg-ge-muted text-ge-muted-foreground",
      )}
    >
      {s.icon}
      <span className="truncate">{s.text}</span>
    </span>
  );
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <span className="flex items-center gap-1 font-semibold" title={label}>
      {icon}
      <span className="sr-only">{label}</span>
      {value}
    </span>
  );
}

function Action({ icon, label, onClick, pressed, post }: { icon: ReactNode; label: string; onClick: () => void; pressed?: boolean; post: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={cn(
        "flex flex-col items-center gap-1 rounded-xl py-2 text-[11px] active:scale-95 [&_svg]:size-6",
        post ? "text-ge-foreground/85 hover:bg-ge-muted" : "text-white/85 hover:bg-white/10",
      )}
    >
      {icon}
      <span className="max-w-full truncate px-0.5">{label}</span>
    </button>
  );
}

function NavArrow({ side, label, disabled, onClick, post }: { side: "start" | "end"; label: string; disabled: boolean; onClick: () => void; post: boolean }) {
  const Icon = side === "start" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "absolute top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full backdrop-blur disabled:opacity-0",
        post ? "bg-ge-foreground/10 hover:bg-ge-foreground/20" : "bg-white/15 hover:bg-white/25",
        side === "start" ? "start-4" : "end-4",
      )}
    >
      <Icon className="size-6 rtl:rotate-180" />
    </button>
  );
}
