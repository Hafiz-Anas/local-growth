"use client";

import { AlertCircle, CalendarClock, CircleCheck, Clock, LoaderCircle, Send, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { PhotoImage } from "@/components/gallery/photo-image";
import { Btn } from "@/components/gallery/kit";
import { useActiveClient } from "@/components/providers/active-client-provider";
import { publishReasonText } from "@/lib/api/errors";
import { chatsApi } from "@/lib/gallery/chats-api";
import type { ChatActionStep, ChatActionView } from "@/lib/gallery/chat-actions";
import { useT } from "@/lib/gallery/hooks";
import { translate, type MessageKey } from "@/lib/gallery/i18n";
import { readChatMessages } from "@/lib/gallery/saved-chats";
import { useStore } from "@/lib/gallery/store";
import { cn } from "@/lib/gallery/utils";
import { useI18n } from "@/lib/i18n/provider";
import { intlLocale } from "@/lib/utils";
import type { AiMsg } from "@/mock-data/gallery/ai-studio";
import { AiRow } from "./messages";

type ActionMsg = Extract<AiMsg, { role: "ai"; kind: "action" }>;

/** City names for the time zones we serve; others show the zone's own city. */
const ZONE_NAME: Record<string, { en: string; ar: string }> = { "Asia/Kuwait": { en: "Kuwait", ar: "الكويت" } };

/** A step shown on the card: the server's record, a request in flight, or the post's live publishing state. */
type Shown = { key: string; state: "done" | "running" | "failed"; text: string };

/**
 * An AI action in the chat (AI4). Saving a draft shows what was saved. Anything that affects Instagram — schedule,
 * post now, move, cancel — shows exactly what will happen (photo, caption, day and time in the business's time zone)
 * and does nothing until the owner taps Approve; "Not now" drops it. The steps follow what really happens: the request
 * while it runs ("Scheduling…"), the server's result ("Scheduled for Fri 8:00 PM"), and for "post now" the post's
 * live state from the Gallery (Posting… → Posted, or why it couldn't be posted). Read-only in admin preview.
 */
export function ActionCard({ msg }: { msg: ActionMsg }) {
  const { t, l, lang } = useT();
  const app = useI18n();
  const { isPreview } = useActiveClient();
  const readOnly = useStore((s) => s.readOnly) || isPreview;
  const view: ChatActionView = msg.action;
  const photos = useStore((s) => s.photos[s.activeAccountId]);
  const cover = photos?.find((p) => p.id === view.photoIds[0]);
  // The post's publishing job as the Gallery has it now (after "post now" was approved).
  const live = useStore((s) => (view.draftId ? s.photos[s.activeAccountId]?.find((p) => p.draftId === view.draftId && p.publish)?.publish : undefined));
  const [pending, setPending] = useState<"approve" | "dismiss" | null>(null);
  const [expired, setExpired] = useState(false);

  // Approve works for 30 minutes; the buttons go when that time is up (the server checks it again).
  useEffect(() => {
    if (view.status !== "proposed" || !view.expiresAt) return;
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, Date.parse(view.expiresAt) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [view.status, view.expiresAt]);

  const zone = ZONE_NAME[view.timeZone]?.[lang] ?? view.timeZone.split("/").pop()?.replace(/_/g, " ") ?? view.timeZone;
  const time = (iso: string) =>
    new Intl.DateTimeFormat(intlLocale(lang), { timeZone: view.timeZone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

  const errorText = (code: string | null | undefined) => {
    if (!code) return t("actionError_generic");
    const own = `actionError_${code}` as MessageKey;
    if (translate(lang, own) !== own) return t(own);
    const api = app.t(`errors.${code}`);
    return api !== `errors.${code}` ? api : publishReasonText(code, app.t);
  };

  const stepText = (s: ChatActionStep): string => {
    if (s.key === "scheduled") return t("actionStep_scheduled", { time: s.at ? time(s.at) : "" });
    if (s.key === "failed" || (s.key === "expired" && view.error)) return errorText(view.error);
    return t(`actionStep_${s.key}` as MessageKey);
  };
  const steps: Shown[] = view.steps.map((s) => ({ key: s.key, state: s.state, text: stepText(s) }));
  if (pending === "approve") {
    const key = view.type === "cancel" ? "cancelling" : view.type === "post_now" || (view.type === "reschedule" && !view.at) ? "posting" : "scheduling";
    steps.push({ key, state: "running", text: t(`actionStep_${key}` as MessageKey) });
  }
  // "Post now" (or moving to now) was approved: follow the post until it's on Instagram.
  const sentNow = view.status === "done" && view.steps.some((s) => s.key === "sent");
  if (sentNow && live) {
    if (live.state === "posted") steps.push({ key: "posted", state: "done", text: t("actionStep_posted") });
    else if (live.state === "failed") steps.push({ key: "postFailed", state: "failed", text: t("actionStep_postFailed", { reason: publishReasonText(live.reason ?? null, app.t) }) });
    else steps.push({ key: "publishing", state: "running", text: t("actionStep_publishing") });
  }

  const canDecide = view.status === "proposed" && !expired && !readOnly;
  const decide = (kind: "approve" | "dismiss") => {
    setPending(kind);
    (kind === "approve" ? chatsApi.approveAction(view.id) : chatsApi.dismissAction(view.id))
      .then((r) => {
        const [next] = readChatMessages([r.message]);
        if (next) useStore.getState().putServerMsg(next);
        // The draft / scheduled post changed: the Gallery (and the post card's status) loads again.
        useStore.getState().sync?.refetch();
      })
      .catch((error) => useStore.getState().sync?.report(error))
      .finally(() => setPending(null));
  };

  const icon = { save_draft: CircleCheck, schedule: CalendarClock, post_now: Send, reschedule: Clock, cancel: XCircle }[view.type];
  const Icon = icon;

  return (
    <AiRow id={msg.id}>
      {msg.text && (
        <p className="whitespace-pre-line" dir="auto">
          {l(msg.text)}
        </p>
      )}
      <div className="max-w-md overflow-hidden rounded-2xl border bg-ge-card" data-testid="action-card" data-type={view.type} data-status={expired && view.status === "proposed" ? "expired" : view.status}>
        <div className="flex items-center gap-2 border-b px-3.5 py-2.5">
          <Icon className={cn("size-[18px] shrink-0", view.status === "failed" ? "text-ge-destructive" : "text-ge-brand")} aria-hidden="true" />
          <p className="text-[14.5px] font-semibold">{t(`actionTitle_${view.type}` as MessageKey)}</p>
        </div>
        <div className="flex gap-3 p-3.5">
          {cover && (
            <span className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-ge-muted">
              <PhotoImage photo={cover} alt={l(cover.dish)} sizes="64px" />
              {view.photoIds.length > 1 && <span className="absolute end-1 bottom-1 rounded-full bg-black/60 px-1.5 text-[10px] font-semibold text-white">+{view.photoIds.length - 1}</span>}
            </span>
          )}
          <div className="min-w-0 flex-1 space-y-1">
            {view.at && (view.type === "schedule" || view.type === "reschedule") && (
              <p className="text-[14px] font-semibold" data-testid="action-when">
                {t("actionWhen", { time: time(view.at), zone })}
              </p>
            )}
            {view.previousAt && (view.type === "reschedule" || view.type === "cancel") && <p className="text-[12.5px] text-ge-muted-foreground">{t("actionWas", { time: time(view.previousAt) })}</p>}
            {(view.type === "post_now" || (view.type === "reschedule" && !view.at)) && view.status === "proposed" && <p className="text-[13px] text-ge-muted-foreground">{t("actionPostNowNote")}</p>}
            {view.type === "cancel" && view.status === "proposed" && <p className="text-[13px] text-ge-muted-foreground">{t("actionCancelNote")}</p>}
            <p className="line-clamp-3 text-[13.5px] whitespace-pre-line" dir="auto" data-testid="action-caption">
              {l(view.caption)}
            </p>
          </div>
        </div>

        {steps.length > 0 && (
          <ol className="space-y-1.5 border-t px-3.5 py-2.5" aria-live="polite">
            {steps.map((s) => (
              <li key={s.key} className={cn("flex items-center gap-2 text-[13.5px]", s.state === "failed" ? "text-ge-destructive" : "text-ge-muted-foreground")} data-testid="action-step" data-step={s.key} data-state={s.state}>
                {s.state === "running" ? (
                  <LoaderCircle className="size-4 shrink-0 animate-spin text-ge-brand" />
                ) : s.state === "failed" ? (
                  <AlertCircle className="size-4 shrink-0" />
                ) : (
                  <CircleCheck className="size-4 shrink-0 text-ge-brand" />
                )}
                <span dir="auto">{s.text}</span>
              </li>
            ))}
          </ol>
        )}

        {view.status === "proposed" && !expired && (
          <div className="space-y-2 border-t px-3.5 py-3">
            {readOnly ? (
              <p className="text-[12.5px] text-ge-muted-foreground">{t("actionPreviewNote")}</p>
            ) : (
              <>
                <div className="flex gap-2">
                  <Btn size="sm" className="flex-1" onClick={() => decide("approve")} disabled={!canDecide || pending !== null} data-testid="action-approve">
                    {t("actionApprove")}
                  </Btn>
                  <Btn size="sm" variant="secondary" className="flex-1" onClick={() => decide("dismiss")} disabled={!canDecide || pending !== null} data-testid="action-dismiss">
                    {t("actionDismiss")}
                  </Btn>
                </div>
                <p className="text-[12px] text-ge-muted-foreground">{t("actionExpiresNote")}</p>
              </>
            )}
          </div>
        )}
        {view.status === "proposed" && expired && (
          <p className="border-t px-3.5 py-2.5 text-[13px] text-ge-muted-foreground" data-testid="action-expired">
            {t("actionIntroExpired")}
          </p>
        )}
      </div>
    </AiRow>
  );
}
