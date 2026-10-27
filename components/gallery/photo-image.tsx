"use client";

import Image, { type ImageProps } from "next/image";
import { cn } from "@/lib/gallery/utils";
import type { Photo } from "@/mock-data/gallery/types";

/**
 * The mock "AI images" reuse photos from the same category with their own look (mirrored, recolored, recropped),
 * so they read as new images in the same style. Real generation would return new files instead.
 */
const LOOKS: Record<number, string> = {
  1: "-scale-x-100 saturate-[1.25] contrast-[1.06]",
  2: "saturate-[1.15] brightness-[1.06] sepia-[.2] object-[30%_50%]",
  3: "-scale-x-100 hue-rotate-[-12deg] saturate-[1.3] contrast-[1.1] object-[70%_40%]",
};

export const lookClass = (look?: number) => (look ? (LOOKS[look] ?? "") : "");

/** A photo's image (thumbnail by default) with its AI look applied. Fills its positioned parent. */
export function PhotoImage({
  photo,
  full,
  className,
  alt = "",
  ...rest
}: { photo: Pick<Photo, "src" | "thumb" | "look">; full?: boolean; alt?: string } & Omit<ImageProps, "src" | "alt" | "fill">) {
  return <Image unoptimized src={full ? photo.src : photo.thumb} alt={alt} fill className={cn("object-cover", lookClass(photo.look), className)} {...rest} />;
}

/** A ready post is a photo with a caption (posted, scheduled or saved). Anything else is a plain photo. */
export const isPost = (p: Pick<Photo, "caption" | "status">) => !!p.caption && p.status !== "none";
