import type { ReactNode } from "react";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MediaTone } from "@/types";
import { Avatar } from "./avatar";

/**
 * A comment exactly like Instagram's: avatar, **author** text inline,
 * then a muted meta row (time · likes · Reply) and a heart on the trailing edge.
 */
export function CommentRow({
  author,
  avatarUrl,
  initials,
  tone,
  text,
  meta,
  badge,
  ring = "none",
  showHeart = true,
  textSlot,
  className,
}: {
  author: string;
  avatarUrl?: string | null;
  initials: string;
  tone: MediaTone;
  text?: string;
  meta?: ReactNode;
  badge?: ReactNode;
  ring?: "none" | "story";
  showHeart?: boolean;
  /** Replaces the text (e.g. with an inline editor). */
  textSlot?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <Avatar src={avatarUrl} initials={initials} tone={tone} size="sm" ring={ring} />
      <div className="min-w-0 flex-1">
        {textSlot ? (
          <>
            <p className="flex items-center gap-1.5 text-body font-semibold">
              {author}
              {badge}
            </p>
            <div className="mt-1">{textSlot}</div>
          </>
        ) : (
          <p className="text-body" dir="auto">
            <span className="me-1.5 font-semibold">{author}</span>
            {badge && <span className="me-1.5 inline-flex align-middle">{badge}</span>}
            {text}
          </p>
        )}
        {meta && <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption font-semibold text-muted">{meta}</div>}
      </div>
      {showHeart && <Heart className="mt-1 size-3 shrink-0 text-muted" aria-hidden="true" />}
    </div>
  );
}
