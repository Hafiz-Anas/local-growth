"use client";

import { AlertCircle, CalendarClock, CircleCheck, Clock, Loader2, PencilLine } from "lucide-react";
import Link from "next/link";
import { publishReasonText } from "@/lib/api/errors";
import { when } from "@/lib/gallery/format";
import { useT } from "@/lib/gallery/hooks";
import { cn } from "@/lib/gallery/utils";
import { useI18n } from "@/lib/i18n/provider";
import { RECONNECT_REASONS, isPublishReason } from "@/lib/publishing/job";
import type { Photo, PhotoPublish } from "@/mock-data/gallery/types";

/**
 * How a post's publishing job reads on screen (real publishing, BE3): the status chip (Scheduled / Waiting for
 * Instagram / Publishing / Posted / Couldn't post) and the line under it saying why it failed or what it waits
 * for, with "Reconnect Instagram" when that's the fix. Reasons are the server's PublishReason codes.
 */

type GalleryKey = Parameters<ReturnType<typeof useT>["t"]>[0];

const WAIT_KEYS: Record<string, GalleryKey> = {
  not_connected: "waitNotConnected",
  rate_limited: "waitRateLimited",
  daily_limit: "waitDailyLimit",
  processing: "waitProcessing",
  processing_timeout: "waitProcessing",
  network: "waitNetwork",
  image_unreachable: "waitNetwork",
  uncertain: "waitUncertain",
  interrupted: "waitUncertain",
};

/** The one line under the status: why it failed (with the fix), or what it is waiting for. Null when there's nothing to say. */
export function usePublishNote(publish: PhotoPublish | undefined): { text: string; reconnect: boolean; tone: "error" | "info" } | null {
  const { t } = useT();
  const app = useI18n();
  if (!publish) return null;
  if (publish.state === "failed") {
    return { text: publishReasonText(publish.reason, app.t), reconnect: isPublishReason(publish.reason) && RECONNECT_REASONS.has(publish.reason), tone: "error" };
  }
  if (publish.state === "waiting" && publish.reason) {
    const key = WAIT_KEYS[publish.reason];
    return key ? { text: t(key), reconnect: publish.reason === "not_connected", tone: "info" } : null;
  }
  if (publish.locked && publish.state === "publishing") return { text: t("lockedNote"), reconnect: false, tone: "info" };
  return null;
}

export function PublishNote({ publish, className }: { publish: PhotoPublish | undefined; className?: string }) {
  const { t } = useT();
  const note = usePublishNote(publish);
  if (!note) return null;
  return (
    <div
      role={note.tone === "error" ? "alert" : "status"}
      data-testid="publish-note"
      className={cn(
        "flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px] leading-snug",
        note.tone === "error" ? "bg-ge-destructive/10 text-ge-destructive" : "bg-ge-muted text-ge-muted-foreground",
        className,
      )}
    >
      {note.tone === "error" ? <AlertCircle className="mt-0.5 size-4 shrink-0" /> : <Clock className="mt-0.5 size-4 shrink-0" />}
      <span className="min-w-0 flex-1">
        {note.text}
        {note.reconnect && (
          <>
            {" "}
            <Link href="/settings?tab=instagram" className="font-semibold underline underline-offset-2">
              {t("reconnectInstagram")}
            </Link>
          </>
        )}
      </span>
    </div>
  );
}

/** The status chip of a ready post. */
export function PostStatus({ photo }: { photo: Photo }) {
  const { t, lang } = useT();
  const state = photo.publish?.state;
  const s =
    photo.status === "published"
      ? { icon: <CircleCheck />, text: photo.publishedAt ? t("publishedOn", { when: when(photo.publishedAt, lang) }) : t("published"), tone: "muted" }
      : state === "publishing"
        ? { icon: <Loader2 className="animate-spin" />, text: t("publishingStatus"), tone: "brand" }
        : state === "waiting"
          ? { icon: <Clock />, text: t("waitingStatus"), tone: "warn" }
          : state === "failed"
            ? { icon: <AlertCircle />, text: t("failedStatus"), tone: "error" }
            : photo.status === "scheduled"
              ? { icon: <CalendarClock />, text: photo.scheduledFor ? when(photo.scheduledFor, lang) : t("scheduled"), tone: "brand" }
              : { icon: <PencilLine />, text: t("savedPost"), tone: "muted" };
  return (
    <span
      data-testid="post-status"
      data-state={photo.status === "published" ? "posted" : (state ?? "draft")}
      className={cn(
        "inline-flex max-w-[60%] items-center gap-1 truncate rounded-full px-2.5 py-1 text-[12px] font-semibold [&_svg]:size-3.5 [&_svg]:shrink-0",
        s.tone === "brand" && "bg-ge-brand-soft text-ge-brand-ink",
        s.tone === "muted" && "bg-ge-muted text-ge-muted-foreground",
        s.tone === "warn" && "bg-ge-warn/15 text-ge-foreground",
        s.tone === "error" && "bg-ge-destructive/10 text-ge-destructive",
      )}
    >
      {s.icon}
      <span className="truncate">{s.text}</span>
    </span>
  );
}
