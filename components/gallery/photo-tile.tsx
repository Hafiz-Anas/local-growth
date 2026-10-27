"use client";

import { Check, Heart, MessageSquareText, Sparkles, User } from "lucide-react";
import { memo } from "react";
import { useT } from "@/lib/gallery/hooks";
import { cn } from "@/lib/gallery/utils";
import type { Photo } from "@/mock-data/gallery/types";
import { PhotoImage, isPost } from "./photo-image";

/** Where the photo came from: made by the AI, or uploaded by the user. `labeled` spells it out (viewer). */
export const SourceBadge = memo(function SourceBadge({ photo, labeled, className }: { photo: Photo; labeled?: boolean; className?: string }) {
  const { t } = useT();
  const ai = photo.source === "ai";
  const label = ai ? t("madeByAi") : t("uploadedByYou");
  if (labeled)
    return (
      <span
        className={cn(
          "inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold text-white backdrop-blur-md",
          ai ? "bg-ge-brand/90" : "bg-black/50",
          className,
        )}
      >
        {ai ? <Sparkles className="size-3.5" aria-hidden /> : <User className="size-3.5" aria-hidden />}
        {label}
      </span>
    );
  return (
    <span
      title={label}
      className={cn(
        "inline-flex h-[18px] items-center gap-0.5 rounded-full text-[10px] leading-none font-bold text-white backdrop-blur-sm",
        ai ? "bg-ge-brand/90 px-1.5" : "w-[18px] justify-center bg-black/45",
        className,
      )}
    >
      {ai ? <Sparkles className="size-2.5" strokeWidth={2.6} aria-hidden /> : <User className="size-2.5" strokeWidth={2.6} aria-hidden />}
      {ai && <span aria-hidden>{t("aiShort")}</span>}
      <span className="sr-only">{label}</span>
    </span>
  );
});

/** Ready posts (photo + caption) get a small caption icon; plain photos get none. */
export const PostBadge = memo(function PostBadge({ photo, className }: { photo: Photo; className?: string }) {
  const { t } = useT();
  if (!isPost(photo)) return null;
  const status = photo.status === "published" ? t("published") : photo.status === "scheduled" ? t("scheduled") : t("savedPost");
  const label = `${t("readyPost")} · ${status}`;
  return (
    <span
      title={label}
      className={cn(
        "grid size-[22px] place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm",
        photo.status === "scheduled" && "bg-ge-brand/90",
        className,
      )}
    >
      <MessageSquareText className="size-3.5" strokeWidth={2.4} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
});

export const PhotoTile = memo(function PhotoTile({
  photo,
  selecting,
  selected,
  onOpen,
  onToggle,
  priority,
}: {
  photo: Photo;
  selecting: boolean;
  selected: boolean;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  priority?: boolean;
}) {
  const { l } = useT();
  return (
    <button
      type="button"
      onClick={() => (selecting ? onToggle(photo.id) : onOpen(photo.id))}
      aria-pressed={selecting ? selected : undefined}
      aria-label={l(photo.dish)}
      className="group relative aspect-square overflow-hidden bg-ge-muted outline-offset-[-2px] focus-visible:rounded-none focus-visible:outline-[3px]"
    >
      {/* The selected shrink sits on a wrapper so it never fights the image's own AI look. */}
      <span className={cn("absolute inset-0 overflow-hidden transition-[transform,opacity] duration-200", selected && "scale-[0.94] rounded-sm opacity-80")}>
        <PhotoImage photo={photo} sizes="(min-width: 1024px) 180px, 33vw" priority={priority} />
      </span>
      <SourceBadge photo={photo} className="absolute start-1.5 top-1.5" />
      <PostBadge photo={photo} className="absolute end-1.5 top-1.5" />
      {photo.favorite && !selecting && (
        <Heart className="absolute start-1.5 bottom-1.5 size-4 fill-white text-white drop-shadow" aria-hidden />
      )}
      {selecting && (
        <span
          className={cn(
            "absolute end-1.5 bottom-1.5 grid size-[22px] place-items-center rounded-full border-[1.5px] border-white shadow",
            selected ? "bg-ge-brand" : "bg-black/20",
          )}
        >
          {selected && <Check className="size-3.5 text-white" strokeWidth={3} />}
        </span>
      )}
    </button>
  );
});
