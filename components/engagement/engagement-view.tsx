"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageCircle, MessagesSquare, Pencil, Send, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { useActiveClient, useFeature } from "@/components/providers/active-client-provider";
import { CommentRow } from "@/components/shared/comment-row";
import { FeatureToggle } from "@/components/shared/feature-toggle";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, Skeleton, SkeletonList } from "@/components/shared/states";
import { StatTile } from "@/components/shared/stat-tile";
import { TimeAgo } from "@/components/shared/time-ago";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api/client";
import { qk, useAction, useEngagement, useReplies, useRules } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { cn, formatNumber, initials, toneFor } from "@/lib/utils";
import { notify } from "@/store/ui-store";
import type { EngagementDto, ReplyDraftDto } from "@/types";
import { KeywordReplies } from "./keyword-replies";

type Settings = EngagementDto["settings"];

/** Whole hours (at least 1) until Instagram stops accepting a DM reply. */
function hoursLeft(replyBy: string): number {
  return Math.max(1, Math.ceil((new Date(replyBy).getTime() - Date.now()) / 3_600_000));
}

export function EngagementView() {
  const { client } = useActiveClient();
  const { t, locale } = useI18n();
  const canRules = useFeature("engagement.dmRules");
  const canReplies = useFeature("engagement.aiReplies");
  const canAutoReply = useFeature("engagement.autoReply");
  const queryClient = useQueryClient();

  // The approval queue holds AI drafts and keyword replies that need approval.
  const canQueue = canReplies || canRules;
  const engagement = useEngagement();
  const rules = useRules(canRules);
  const replies = useReplies(canQueue);

  const [confirmAuto, setConfirmAuto] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  // Settings ------------------------------------------------------------------
  const updateSettings = useAction({
    mutationFn: (patch: Partial<Pick<Settings, "autoReply" | "priceQuestionsToWhatsApp">>) =>
      apiFetch<EngagementDto>("/api/engagement/settings", { method: "PATCH", body: patch }),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: qk.engagement });
      const previous = queryClient.getQueryData<EngagementDto>(qk.engagement);
      queryClient.setQueryData<EngagementDto>(qk.engagement, (d) => d && { ...d, settings: { ...d.settings, ...patch } });
      return { previous };
    },
    onError: (_e, _p, context) => queryClient.setQueryData(qk.engagement, context?.previous),
    onSuccess: (data) => queryClient.setQueryData(qk.engagement, data),
  });

  // Replies -------------------------------------------------------------------
  const removeReply = async (id: string) => {
    await queryClient.cancelQueries({ queryKey: qk.replies });
    const previous = queryClient.getQueryData<ReplyDraftDto[]>(qk.replies);
    queryClient.setQueryData<ReplyDraftDto[]>(qk.replies, (list) => list?.filter((r) => r.id !== id));
    return { previous };
  };
  const restoreReplies = (_e: unknown, _v: unknown, context?: { previous?: ReplyDraftDto[] }) => queryClient.setQueryData(qk.replies, context?.previous);
  const afterReply = () => {
    queryClient.invalidateQueries({ queryKey: qk.dashboard });
    queryClient.invalidateQueries({ queryKey: qk.engagement });
  };

  const approve = useAction({
    mutationFn: ({ id, text }: { id: string; text?: string; channel: ReplyDraftDto["channel"] }) =>
      apiFetch<ReplyDraftDto>(`/api/reply-drafts/${id}/approve`, { method: "POST", body: text ? { draftReply: text } : {} }),
    onMutate: ({ id }) => removeReply(id),
    onError: (error, vars, context) => {
      restoreReplies(error, vars, context);
      // The DM's 24-hour window closed: the server expired it, so it leaves the queue.
      if (error.code === "dm_window_closed") queryClient.invalidateQueries({ queryKey: qk.replies });
    },
    onSuccess: (_reply, { channel }) => {
      setEditing(null);
      notify.success(t(channel === "dm" ? "engagement.queue.dmSent" : "engagement.queue.posted"));
      afterReply();
    },
  });
  const dismiss = useAction({
    mutationFn: (id: string) => apiFetch<ReplyDraftDto>(`/api/reply-drafts/${id}/dismiss`, { method: "POST" }),
    onMutate: (id) => removeReply(id),
    onError: restoreReplies,
    onSuccess: afterReply,
  });
  const saveReply = useAction({
    mutationFn: ({ id, text }: { id: string; text: string }) => apiFetch<ReplyDraftDto>(`/api/reply-drafts/${id}`, { method: "PATCH", body: { draftReply: text } }),
    onSuccess: (reply) => {
      queryClient.setQueryData<ReplyDraftDto[]>(qk.replies, (list) => list?.map((r) => (r.id === reply.id ? reply : r)));
      setEditing(null);
    },
  });

  if (engagement.isPending) return <EngagementSkeleton />;
  if (engagement.isError) return <ErrorState error={engagement.error} onRetry={() => engagement.refetch()} />;

  const { stats, settings } = engagement.data;
  const autoReply = settings.autoReply ?? false;
  const queue = replies.data ?? [];
  const ruleList = rules.data ?? [];

  function setAutoReply(on: boolean) {
    if (on) setConfirmAuto(true);
    else updateSettings.mutate({ autoReply: false });
  }

  return (
    <div>
      <PageHeader title={t("engagement.title")} subtitle={t("engagement.subtitle")} />

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={MessageCircle} label={t("engagement.stats.commentsToday")} value={formatNumber(stats.commentsToday, locale)} />
        <StatTile icon={Send} label={t("engagement.stats.dmsSent")} value={formatNumber(stats.dmsSent, locale)} />
        {canQueue && <StatTile icon={ShieldCheck} label={t("engagement.stats.awaiting")} value={replies.data ? queue.length : "–"} accent={queue.length > 0} />}
        {canRules && <StatTile icon={Zap} label={t("engagement.stats.activeRules")} value={rules.data ? ruleList.filter((r) => r.active).length : "–"} />}
      </div>

      <div className={cn("mb-8 grid gap-6", canQueue && "lg:grid-cols-[1fr_320px]")}>
        {canQueue && (
          <Card>
            <CardHeader className="border-b border-separator">
              <div>
                <CardTitle>{t("engagement.queue.title")}</CardTitle>
                <CardDescription>{t("engagement.queue.subtitle")}</CardDescription>
              </div>
            </CardHeader>

            {replies.isPending ? (
              <SkeletonList rows={3} />
            ) : replies.isError ? (
              <ErrorState error={replies.error} onRetry={() => replies.refetch()} className="m-4" />
            ) : queue.length === 0 ? (
              <EmptyState icon={MessagesSquare} title={t("engagement.queue.empty")} hint={t("engagement.queue.emptyHint")} className="py-14" />
            ) : (
              <ul className="divide-y divide-separator">
                {queue.map((comment) => {
                  const reply = comment.draftReply;
                  const isEditing = editing?.id === comment.id;
                  const isDm = comment.channel === "dm";
                  const author = comment.commenterUsername || t("engagement.queue.dmCustomer");
                  return (
                    <li key={comment.id} className="px-4 py-4">
                      {isDm ? (
                        <p className="mb-2.5 flex flex-wrap items-center gap-x-1.5 text-caption text-muted">
                          <Send className="size-3.5 shrink-0" aria-hidden="true" />
                          <span className="font-semibold text-foreground">{t("engagement.queue.dm")}</span>
                          {comment.replyBy && <span>· {t("engagement.queue.replyWithin", { hours: hoursLeft(comment.replyBy) })}</span>}
                        </p>
                      ) : (
                        comment.postCaption && (
                          <p className="mb-2.5 truncate text-caption text-muted">
                            {t("engagement.queue.on")} “<bdi>{comment.postCaption}</bdi>”
                          </p>
                        )
                      )}
                      <CommentRow
                        author={author}
                        avatarUrl={comment.commenterAvatarUrl}
                        initials={initials(author.replace(/[._]/g, " "))}
                        tone={toneFor(comment.commenterUsername || comment.commentId)}
                        text={comment.commentText}
                        meta={
                          <>
                            <TimeAgo iso={comment.createdAt} />
                            {!isDm && comment.likes > 0 && <span>{t(comment.likes === 1 ? "common.like" : "common.likes", { count: comment.likes })}</span>}
                            {!isDm && <span>{t("common.reply")}</span>}
                          </>
                        }
                      />
                      <div className="ms-11 mt-3 rounded-card bg-secondary-bg p-3">
                        <CommentRow
                          author={client.handle}
                          avatarUrl={client.avatarUrl}
                          initials={client.avatarInitials}
                          tone={client.avatarTone}
                          ring="story"
                          showHeart={false}
                          text={reply}
                          badge={
                            comment.keywordRule ? (
                              <Badge variant="blue" size="sm">
                                <Zap />
                                {t("engagement.queue.keywordReply")} · <bdi>{comment.keywordRule.keywords[0]}</bdi>
                              </Badge>
                            ) : (
                              <Badge variant="blue" size="sm">
                                <Sparkles />
                                {t("engagement.queue.aiDraft")}
                              </Badge>
                            )
                          }
                          textSlot={
                            isEditing ? (
                              <Textarea value={editing.text} onChange={(e) => setEditing({ id: comment.id, text: e.target.value })} rows={3} dir="auto" autoFocus />
                            ) : undefined
                          }
                          meta={
                            <>
                              <span>{comment.language === "ar" ? t("engagement.queue.kuwaiti") : t("engagement.queue.english")}</span>
                            </>
                          }
                        />
                        {comment.keywordRule && !comment.draftReply.trim() && !isEditing && (
                          <p className="ms-11 mt-2 text-caption text-warning">{t("engagement.queue.dmOnly")}</p>
                        )}
                        {comment.privateReply && (
                          <div className="ms-11 mt-2.5 text-caption text-muted">
                            <p className="flex items-center gap-1.5">
                              <Send className="size-3.5 shrink-0" aria-hidden="true" />
                              {t("engagement.queue.withDm")}
                            </p>
                            <p className="mt-1 w-fit max-w-full rounded-[18px] bg-background px-3 py-1.5 text-body text-foreground" dir="auto">
                              {comment.privateReply}
                            </p>
                          </div>
                        )}
                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                          {isEditing ? (
                            <>
                              <Button variant="secondary" onClick={() => setEditing(null)}>
                                {t("common.cancel")}
                              </Button>
                              <Button onClick={() => saveReply.mutate({ id: comment.id, text: editing.text })} disabled={!editing.text.trim() || saveReply.isPending}>
                                {saveReply.isPending && <Loader2 className="size-4 animate-spin" />}
                                {t("common.save")}
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button variant="ghost" onClick={() => dismiss.mutate(comment.id)}>
                                {t("engagement.queue.dismiss")}
                              </Button>
                              <Button variant="secondary" onClick={() => setEditing({ id: comment.id, text: reply })}>
                                <Pencil className="size-3.5" />
                                {t("common.edit")}
                              </Button>
                              <Button onClick={() => approve.mutate({ id: comment.id, channel: comment.channel })}>
                                {isDm ? t("engagement.queue.sendDm") : t("engagement.queue.approve")}
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        )}

        <Card className="h-fit">
          <CardHeader className="pb-0">
            <CardTitle>{t("engagement.controls.title")}</CardTitle>
          </CardHeader>
          <div className="divide-y divide-separator px-4 pb-1">
            <FeatureToggle
              label={t("engagement.controls.manualApproval")}
              description={canAutoReply ? t("engagement.controls.manualApprovalHint") : t("engagement.controls.manualApprovalLocked")}
              checked={!autoReply}
              disabled={!canAutoReply}
              onCheckedChange={(v) => setAutoReply(!v)}
            />
            {canAutoReply && (
              <FeatureToggle
                label={t("engagement.controls.autoReply")}
                description={t("engagement.controls.autoReplyHint")}
                checked={autoReply}
                onCheckedChange={setAutoReply}
              />
            )}
          </div>
        </Card>
      </div>

      {canRules && <KeywordReplies />}

      <ConfirmDialog
        open={confirmAuto}
        onOpenChange={setConfirmAuto}
        title={t("engagement.controls.confirmTitle")}
        description={t("engagement.controls.confirmBody")}
        confirmLabel={t("engagement.controls.confirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => updateSettings.mutate({ autoReply: true })}
      />
    </div>
  );
}

function EngagementSkeleton() {
  return (
    <div aria-busy="true">
      <div className="mb-6 space-y-2.5">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[84px] rounded-panel" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="rounded-panel border border-border">
          <SkeletonList rows={4} />
        </div>
        <Skeleton className="h-52 rounded-panel" />
      </div>
    </div>
  );
}
