"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { MediaTone } from "@/types";
import { toneBackground } from "./media";

const SIZES = {
  xs: "size-6 text-[9px]",
  sm: "size-8 text-[11px]",
  md: "size-11 text-body",
  lg: "size-14 text-title",
  xl: "size-[77px] text-heading md:size-[150px] md:text-[40px]",
} as const;

export type AvatarSize = keyof typeof SIZES;

export interface AvatarProps {
  /** Profile picture. Falls back to initials when missing or when it fails to load. */
  src?: string | null;
  /** Accessible name; omit for decorative avatars next to a visible name. */
  alt?: string;
  initials: string;
  tone: MediaTone;
  size?: AvatarSize;
  /** "story" → Instagram gradient ring; "seen" → neutral ring. */
  ring?: "none" | "story" | "seen";
  /** Small indicator pinned to the bottom-end corner (e.g. an admin shield). */
  badge?: ReactNode;
  className?: string;
}

/** Round profile picture with optional story ring, used for every avatar in the app. */
export function Avatar({ src, alt = "", initials, tone, size = "md", ring = "none", badge, className }: AvatarProps) {
  // Keyed on src so a new image gets a fresh load attempt.
  return <AvatarInner key={src ?? "none"} {...{ src, alt, initials, tone, size, ring, badge, className }} />;
}

function AvatarInner({ src, alt = "", initials, tone, size = "md", ring = "none", badge, className }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;

  const face = (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-pill font-semibold text-white select-none",
        SIZES[size],
        ring !== "none" && "border-2 border-background",
      )}
      style={showImage ? undefined : { background: toneBackground(tone) }}
      role={alt && !showImage ? "img" : undefined}
      aria-label={alt && !showImage ? alt : undefined}
      aria-hidden={!alt || undefined}
    >
      {showImage ? (
        // Plain <img>: local SVGs and blob: previews need no optimisation.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src!}
          alt={alt}
          draggable={false}
          className="size-full object-cover"
          onError={() => setFailed(true)}
          // Catches images that failed before hydration attached onError.
          ref={(img) => {
            if (img && img.complete && img.naturalWidth === 0) setFailed(true);
          }}
        />
      ) : (
        initials
      )}
    </span>
  );

  const ringed =
    ring === "none" ? (
      face
    ) : (
      <span className={cn("inline-flex shrink-0 rounded-pill p-[2px]", ring === "story" ? "bg-ig-gradient" : "bg-border")}>{face}</span>
    );

  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      {ringed}
      {badge && <span className="absolute -end-0.5 -bottom-0.5">{badge}</span>}
    </span>
  );
}
