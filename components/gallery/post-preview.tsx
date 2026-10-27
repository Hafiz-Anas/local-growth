"use client";

import { Bookmark, Heart, MapPin, MessageCircle, Send } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Avatar } from "@/components/gallery/kit";
import { useT } from "@/lib/gallery/hooks";
import { useAccount } from "@/lib/gallery/store";
import { cn } from "@/lib/gallery/utils";
import type { Lang, Photo } from "@/mock-data/gallery/types";
import { PhotoImage } from "./photo-image";

/* ---------- Instagram-style preview ---------- */

export function PostPreview({ photos, caption, captionLang, expanded: startExpanded = false }: { photos: Photo[]; caption: string; captionLang: Lang; expanded?: boolean }) {
  const { l } = useT();
  const account = useAccount();
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(startExpanded);

  return (
    <article className="overflow-hidden border-y bg-ge-background lg:rounded-2xl lg:border">
      <header className="flex items-center gap-2.5 px-3 py-2.5">
        <Avatar src={account.avatar} alt={account.handle} size={32} />
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[13px] font-semibold" dir="ltr">
            {account.handle}
          </p>
          <p className="flex items-center gap-0.5 text-[11px] text-ge-muted-foreground">
            <MapPin className="size-3" />
            {l(account.location)}
          </p>
        </div>
      </header>
      <div className="relative">
        <div
          className="no-scrollbar flex aspect-square snap-x snap-mandatory overflow-x-auto bg-ge-muted"
          onScroll={(e) => {
            const el = e.currentTarget;
            setIndex(Math.round(Math.abs(el.scrollLeft) / el.clientWidth));
          }}
        >
          {photos.map((p, i) => (
            <div key={p.id} className="relative aspect-square w-full shrink-0 snap-center">
              <PhotoImage photo={p} full alt={l(p.dish)} sizes="(min-width: 1024px) 420px, 100vw" priority={i === 0} />
            </div>
          ))}
        </div>
        {photos.length > 1 && (
          <span className="absolute end-3 top-3 rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
            {index + 1}/{photos.length}
          </span>
        )}
      </div>
      <div className="flex items-center gap-4 px-3 pt-2.5 [&_svg]:size-6">
        <Heart strokeWidth={1.8} />
        <MessageCircle strokeWidth={1.8} className="-scale-x-100" />
        <Send strokeWidth={1.8} />
        {photos.length > 1 && (
          <div className="flex flex-1 justify-center gap-1">
            {photos.map((p, i) => (
              <span key={p.id} className={cn("size-1.5 rounded-full", i === index ? "bg-ge-brand" : "bg-ge-foreground/20")} />
            ))}
          </div>
        )}
        <Bookmark strokeWidth={1.8} className="ms-auto" />
      </div>
      <div className="px-3 pt-2 pb-3 text-[14px] leading-snug" dir={captionLang === "ar" ? "rtl" : "ltr"} lang={captionLang}>
        <p className={cn("whitespace-pre-line", !expanded && "line-clamp-3")}>
          <bdi className="font-semibold">{account.handle}</bdi> <CaptionText text={caption} />
        </p>
        {!expanded && caption.length > 110 && (
          <button type="button" onClick={() => setExpanded(true)} className="text-ge-muted-foreground">
            {captionLang === "ar" ? "المزيد" : "more"}
          </button>
        )}
      </div>
    </article>
  );
}

/** Hashtags in the brand ink color, like links in a real post. Each is isolated so mixed Arabic/English tags keep their order. */
export function CaptionText({ text }: { text: string }): ReactNode {
  return text.split(/(\s+)/).map((part, i) =>
    part.startsWith("#") ? (
      <bdi key={i} className="text-ge-brand-ink">
        {part}
      </bdi>
    ) : (
      part
    ),
  );
}
