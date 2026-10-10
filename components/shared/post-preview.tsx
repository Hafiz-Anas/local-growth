import type { ReactNode } from "react";
import { Bookmark, Heart, MessageCircle, MoreHorizontal, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MediaIcon, MediaTone } from "@/types";
import { Avatar } from "./avatar";
import { MediaPlaceholder } from "./media";

/** Renders a caption like Instagram: hashtags and @mentions in link colour. */
export function CaptionText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/([#@][\p{L}\p{N}_.]+)/u);
  return (
    <span className={cn("whitespace-pre-line", className)}>
      {parts.map((part, i) =>
        /^[#@]/.test(part) ? (
          <span key={i} className="text-link">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </span>
  );
}

/**
 * A post card that looks like a real Instagram feed post.
 * Pass `captionSlot` to replace the caption (e.g. with an editor) and
 * `footer` for tool actions under the post. `mediaSrc` shows a real image over
 * the placeholder artwork; `mediaOverlay` sits on top of the media (labels, spinners).
 */
export function PostPreview({
  handle,
  location,
  avatarUrl,
  avatarInitials,
  avatarTone,
  mediaTone,
  mediaIcon,
  caption,
  hashtags = [],
  likesLabel,
  timeLabel,
  mediaBadge,
  mediaSrc,
  mediaAlt,
  mediaOverlay,
  captionSlot,
  footer,
  className,
}: {
  handle: string;
  location?: string;
  avatarUrl?: string | null;
  avatarInitials: string;
  avatarTone: MediaTone;
  mediaTone: MediaTone;
  mediaIcon: MediaIcon;
  caption: string;
  hashtags?: string[];
  likesLabel?: ReactNode;
  timeLabel?: ReactNode;
  mediaBadge?: ReactNode;
  mediaSrc?: string | null;
  mediaAlt?: string;
  mediaOverlay?: ReactNode;
  captionSlot?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <article className={cn("overflow-hidden rounded-card border border-border bg-background", className)}>
      <header className="flex items-center gap-2.5 px-3 py-2.5">
        <Avatar src={avatarUrl} initials={avatarInitials} tone={avatarTone} size="sm" ring="story" />
        <div className="min-w-0 flex-1 leading-4">
          <p className="truncate text-body font-semibold">{handle}</p>
          {location && <p className="truncate text-caption text-foreground">{location}</p>}
        </div>
        <MoreHorizontal className="size-6 text-foreground" aria-hidden="true" />
      </header>

      <MediaPlaceholder tone={mediaTone} icon={mediaIcon} src={mediaSrc} alt={mediaAlt} className="aspect-square w-full">
        {mediaBadge && <div className="absolute start-3 top-3">{mediaBadge}</div>}
        {mediaOverlay}
      </MediaPlaceholder>

      <div className="px-3 pt-2.5 pb-3">
        <div className="flex items-center gap-4 [&_svg]:size-6">
          <Heart strokeWidth={1.75} aria-hidden="true" />
          <MessageCircle strokeWidth={1.75} className="rtl:-scale-x-100" aria-hidden="true" />
          <Send strokeWidth={1.75} className="rtl:-scale-x-100" aria-hidden="true" />
          <Bookmark strokeWidth={1.75} className="ms-auto" aria-hidden="true" />
        </div>
        {likesLabel && <p className="mt-2 text-body font-semibold">{likesLabel}</p>}
        <div className="mt-1.5 text-body" dir="auto">
          {captionSlot ?? (
            <p>
              <span className="me-1 font-semibold">{handle}</span>
              <CaptionText text={caption} />
              {hashtags.length > 0 && <span className="mt-1 block text-link">{hashtags.join(" ")}</span>}
            </p>
          )}
        </div>
        {timeLabel && <p className="mt-2 text-[10px] tracking-wide text-muted uppercase">{timeLabel}</p>}
      </div>

      {footer && <footer className="border-t border-separator">{footer}</footer>}
    </article>
  );
}
