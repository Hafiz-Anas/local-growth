"use client";

import { ImageOff, Plus, SquarePlay } from "lucide-react";
import type { PostPurpose } from "@/config/onboarding";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { BrandPostDto } from "@/types";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** "Promotion / Discount", or the business's own words for "Other". */
export function purposeLabel(t: Translate, purpose: PostPurpose, other?: string | null) {
  return purpose === "other" && other ? other : t(`purposes.${purpose}`);
}

/** Uploaded videos play inline (muted); Instagram reels show their thumbnail. Missing media gets a placeholder. */
export function BrandMedia({ url, type, alt = "", className }: { url: string | null; type: "image" | "video"; alt?: string; className?: string }) {
  if (!url) {
    return (
      <div className={cn("flex items-center justify-center bg-secondary-bg text-muted", className)} aria-hidden={!alt || undefined} aria-label={alt || undefined}>
        <ImageOff className="size-6" strokeWidth={1.5} />
      </div>
    );
  }
  const isVideoFile = type === "video" && /\.mp4($|\?)/i.test(url);
  return (
    <div className={cn("relative overflow-hidden bg-secondary-bg", className)}>
      {isVideoFile ? (
        <video src={url} muted playsInline preload="metadata" className="size-full object-cover" aria-label={alt || undefined} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- user uploads and Instagram CDN URLs, not static assets
        <img src={url} alt={alt} loading="lazy" className="size-full object-cover" />
      )}
      {type === "video" && (
        <SquarePlay className="absolute end-2 top-2 size-5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" aria-hidden="true" />
      )}
    </div>
  );
}

/** Small pill on a post tile with its purpose. */
export function PurposeTag({ purpose, other, className }: { purpose: PostPurpose; other?: string | null; className?: string }) {
  const { t } = useI18n();
  return (
    <span className={cn("inline-flex max-w-full items-center truncate rounded-pill bg-black/65 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur-sm", className)}>
      <bdi className="truncate">{purposeLabel(t, purpose, other)}</bdi>
    </span>
  );
}

/**
 * Instagram profile grid (3 columns, 4px gaps) of brand posts with purpose
 * labels. With `slots`, empty tiles fill the grid up to that many and call `onAdd`.
 */
export function BrandPostGrid({
  posts,
  slots,
  onSelect,
  onAdd,
  className,
}: {
  posts: BrandPostDto[];
  slots?: number;
  onSelect?: (post: BrandPostDto) => void;
  onAdd?: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  const empty = slots ? Math.max(0, slots - posts.length) : 0;
  return (
    <ul className={cn("grid grid-cols-3 gap-1", className)}>
      {posts.map((post, i) => {
        const label = `${t("brand.posts.postN", { n: i + 1 })} · ${purposeLabel(t, post.purpose, post.purposeOther)}`;
        const tile = (
          <>
            <BrandMedia url={post.mediaUrl} type={post.mediaType} className="aspect-square w-full" />
            <span className="absolute inset-x-1.5 bottom-1.5 flex">
              <PurposeTag purpose={post.purpose} other={post.purposeOther} />
            </span>
          </>
        );
        return (
          <li key={post.id} className="relative">
            {onSelect ? (
              <button type="button" onClick={() => onSelect(post)} className="relative block w-full outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary" aria-label={label}>
                {tile}
              </button>
            ) : (
              <div className="relative" aria-label={label} role="img">
                {tile}
              </div>
            )}
          </li>
        );
      })}
      {Array.from({ length: empty }, (_, i) => (
        <li key={`empty-${i}`}>
          <button
            type="button"
            onClick={onAdd}
            disabled={!onAdd}
            className="flex aspect-square w-full flex-col items-center justify-center gap-1.5 border border-dashed border-border bg-secondary-bg text-muted transition-colors hover:bg-hover hover:text-foreground disabled:pointer-events-none"
          >
            <Plus className="size-6" strokeWidth={1.5} aria-hidden="true" />
            <span className="text-caption font-semibold">{t("brand.posts.addSlot", { n: posts.length + i + 1 })}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
