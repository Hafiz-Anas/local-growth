"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Clock, History, Loader2, MessagesSquare, Pencil, RefreshCw, Send, Sparkles, Zap } from "lucide-react";
import { CommentRow } from "@/components/shared/comment-row";
import { EmptyState, ErrorState, SkeletonList } from "@/components/shared/states";
import { TimeAgo } from "@/components/shared/time-ago";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { reportError } from "@/lib/api/errors";
import { qk, useAction, useReplies, useReplySummary, useSentReplies } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { DM_WINDOW_WARN_HOURS, REGENERATE_TONES, hoursLeft, replyLimit, replyProblem, type RegenerateTone } from "@/lib/replies";
import { cn, formatNumber, initials, toneFor } from "@/lib/utils";
import { notify } from "@/store/ui-store";
import type { ReplyDraftDto, ReplySummaryDto } from "@/types";

/** Which Engagement tab a reply belongs to: keyword replies, AI replies to comments or AI replies to DMs. */
export type ReplyKind = "comment" | "dm" | "keyword";

export function replyKind(reply: ReplyDraftDto): ReplyKind {
  if (reply.keywordRule) return "keyword";
  return reply.channel === "dm" ? "dm" : "comment";
}

const EMPTY_ICON = { comment: MessagesSquare, dm: Send, keyword: Zap } as const;

/**
 * Engagement → the reply queue of one tab (`kind`): "Waiting" (drafts to approve: tap the reply to
 * edit, Regenerate with a tone, Send or Dismiss; replies that can't be sent any more stay with a
 * warning until removed) and "Sent" (how each reply went out: as drafted, edited or written by hand).
 * All tabs share one cached list; each shows only its own kind.
 */
export function ReplyQueue({ kind, connected = true }: { kind: ReplyKind; connected?: boolean }) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const replies = useReplies();
  const [tab, setTab] = useState<"waiting" | "sent">("waiting");
  const summary = useReplySummary();
  const sent = useSentReplies(tab === "sent");

  const queue = (replies.data ?? []).filter((r) => replyKind(r) === kind);
  const waiting = queue.filter((r) => !r.blocked).length;

  // Optimistic removal from the queue, rolled back on error.
  const removeReply = async (id: string) => {
    await queryClient.cancelQueries({ queryKey: qk.replies, exact: true });
    const previous = queryClient.getQueryData<ReplyDraftDto[]>(qk.replies);
    queryClient.setQueryData<ReplyDraftDto[]>(qk.replies, (list) => list?.filter((r) => r.id !== id));
    return { previous };
  };
  const restore = (context?: { previous?: ReplyDraftDto[] }) => queryClient.setQueryData(qk.replies, context?.previous);
  const afterChange = () => {
    queryClient.invalidateQueries({ queryKey: qk.dashboard });
    queryClient.invalidateQueries({ queryKey: qk.engagement });
    queryClient.invalidateQueries({ queryKey: qk.sentReplies });
    queryClient.invalidateQueries({ queryKey: qk.replySummary });
  };

  const send = useAction({
    mutationFn: ({ id, text }: { id: string; text?: string; channel: ReplyDraftDto["channel"] }) =>
      apiFetch<ReplyDraftDto>(`/api/reply-drafts/${id}/approve`, { method: "POST", body: text !== undefined ? { draftReply: text } : {} }),
    onMutate: ({ id }) => removeReply(id),
    onError: (error, _vars, context) => {
      restore(context);
      // Can't be sent any more (window closed / comment deleted): reload so it shows its warning.
      if (error.code === "dm_window_closed" || error.code === "comment_unavailable") queryClient.invalidateQueries({ queryKey: qk.replies, exact: true });
    },
    onSuccess: (_reply, { channel }) => {
      notify.success(t(channel === "dm" ? "engagement.queue.dmSent" : "engagement.queue.posted"));
      afterChange();
    },
  });
  const dismiss = useAction({
    mutationFn: (id: string) => apiFetch<ReplyDraftDto>(`/api/reply-drafts/${id}/dismiss`, { method: "POST" }),
    onMutate: (id) => removeReply(id),
    onError: (_e, _id, context) => restore(context),
    onSuccess: afterChange,
  });
  const regenerate = useAction({
    mutationFn: ({ id, tone }: { id: string; tone: RegenerateTone | null }) => apiFetch<ReplyDraftDto>(`/api/reply-drafts/${id}/regenerate`, { method: "POST", body: { tone } }),
    meta: { handlesErrors: true },
    onSuccess: (reply) => queryClient.setQueryData<ReplyDraftDto[]>(qk.replies, (list) => list?.map((r) => (r.id === reply.id ? reply : r))),
    onError: (error: ApiClientError) => {
      // The AI can't write right now: disable Regenerate everywhere (editing and sending still work).
      if (error.code === "regenerate_unavailable") {
        queryClient.setQueryData<ReplySummaryDto | null>(qk.replySummary, (s) => s && { ...s, regenerate: { available: false, reason: "unavailable" } });
      } else reportError(error, t);
    },
  });
  const regenerateAvailable = summary.data?.regenerate.available ?? true;

  return (
    <Card className="overflow-hidden" data-testid="reply-queue">
      <Tabs value={tab} onValueChange={(v) => setTab(v as "waiting" | "sent")}>
        <div className="px-4">
          <TabsList className="gap-6">
            <TabsTrigger value="waiting" data-testid="replies-tab-waiting">
              <MessagesSquare />
              {t("engagement.queue.waiting")}
              {replies.data && waiting > 0 && (
                <span className="ms-0.5 rounded-pill bg-primary px-1.5 text-[11px] leading-4 text-on-primary tabular-nums">{formatNumber(waiting, locale)}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="sent" data-testid="replies-tab-sent">
              <History />
              {t("engagement.queue.sent")}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="waiting">
          {replies.isPending ? (
            <SkeletonList rows={3} />
          ) : replies.isError ? (
            <ErrorState error={replies.error} onRetry={() => replies.refetch()} className="m-4" />
          ) : queue.length === 0 ? (
            <EmptyState
              icon={EMPTY_ICON[kind]}
              title={t(connected ? "engagement.queue.empty" : "engagement.queue.notConnected")}
              hint={t(connected ? `engagement.queue.emptyHint.${kind}` : "engagement.queue.notConnectedHint")}
              className="py-14"
            />
          ) : (
            <ul className="divide-y divide-separator">
              {queue.map((reply) => (
                <ReplyCard
                  key={reply.id}
                  reply={reply}
                  regenerateAvailable={regenerateAvailable}
                  regenerating={regenerate.isPending && regenerate.variables?.id === reply.id}
                  onSend={(text) => send.mutate({ id: reply.id, text, channel: reply.channel })}
                  onDismiss={() => dismiss.mutate(reply.id)}
                  onRegenerate={(tone) => regenerate.mutate({ id: reply.id, tone })}
                />
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="sent">
          <SentReplies sent={sent.data?.filter((r) => replyKind(r) === kind)} loading={sent.isPending} error={sent.isError ? sent.error : null} onRetry={() => sent.refetch()} />
        </TabsContent>
      </Tabs>
    </Card>
  );
}

// ── One reply waiting for approval ─────────────────────────────────────────────

function ReplyCard({
  reply,
  regenerateAvailable,
  regenerating,
  onSend,
  onDismiss,
  onRegenerate,
}: {
  reply: ReplyDraftDto;
  regenerateAvailable: boolean;
  regenerating: boolean;
  onSend: (text?: string) => void;
  onDismiss: () => void;
  onRegenerate: (tone: RegenerateTone | null) => void;
}) {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState<string | null>(null);
  const [tones, setTones] = useState(false);

  const isDm = reply.channel === "dm";
  const isKeyword = Boolean(reply.keywordRule);
  const author = reply.commenterUsername || t("engagement.queue.dmCustomer");
  const limit = replyLimit(reply.channel);
  const dmOnly = isKeyword && Boolean(reply.privateReply?.trim());
  const problem = editing !== null ? replyProblem(editing, reply.channel, { allowEmpty: dmOnly }) : null;
  const left = isDm && reply.replyBy ? hoursLeft(reply.replyBy) : null;
  const blocked = reply.blocked;
  const edited = reply.draftReply !== reply.aiReply;

  function startEdit() {
    if (blocked || regenerating) return;
    setTones(false);
    setEditing(reply.draftReply);
  }

  return (
    <li className="px-4 py-4" data-testid="reply-item" data-reply-id={reply.id}>
      {isDm ? (
        <p className="mb-2.5 flex flex-wrap items-center gap-x-1.5 text-caption text-muted">
          <Send className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="font-semibold text-foreground">{t("engagement.queue.dm")}</span>
          {left !== null && !blocked && (
            <span className={cn(left <= DM_WINDOW_WARN_HOURS && "font-semibold text-warning")} data-testid="reply-window">
              · {t(left <= DM_WINDOW_WARN_HOURS ? "engagement.queue.closingSoon" : "engagement.queue.replyWithin", { hours: formatNumber(left, locale) })}
            </span>
          )}
        </p>
      ) : (
        reply.postCaption && (
          <p className="mb-2.5 truncate text-caption text-muted">
            {t("engagement.queue.on")} “<bdi>{reply.postCaption}</bdi>”
          </p>
        )
      )}
      <CommentRow
        author={author}
        avatarUrl={reply.commenterAvatarUrl}
        initials={initials(author.replace(/[._]/g, " "))}
        tone={toneFor(reply.commenterUsername || reply.commentId)}
        text={reply.commentText}
        meta={<TimeAgo iso={reply.createdAt} />}
      />

      <div className={cn("mt-3 rounded-card bg-secondary-bg p-3 sm:ms-11", blocked && "opacity-70")}>
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {isKeyword ? (
            <Badge variant="blue" size="sm">
              <Zap />
              {t("engagement.queue.keywordReply")} · <bdi>{reply.keywordRule!.keywords[0]}</bdi>
            </Badge>
          ) : (
            <Badge variant="blue" size="sm">
              <Sparkles />
              {t("engagement.queue.aiDraft")}
            </Badge>
          )}
          {edited && editing === null && (
            <Badge variant="neutral" size="sm">
              {t("engagement.queue.edited")}
            </Badge>
          )}
        </div>

        {editing !== null ? (
          <div className="space-y-1.5">
            <Textarea
              value={editing}
              onChange={(e) => setEditing(e.target.value)}
              rows={3}
              dir="auto"
              autoFocus
              aria-label={t("engagement.queue.editLabel")}
              aria-invalid={Boolean(problem) || undefined}
              data-testid="reply-editor"
            />
            <div className="flex items-start justify-between gap-3 text-caption">
              <p className={cn("min-w-0", problem ? "text-danger" : "text-muted")} role={problem ? "alert" : undefined}>
                {problem ? t(`engagement.queue.problem.${problem}`, { max: formatNumber(limit, locale) }) : t(isDm ? "engagement.queue.limitDm" : "engagement.queue.limitComment")}
              </p>
              <span className={cn("shrink-0 tabular-nums", editing.trim().length > limit ? "font-semibold text-danger" : "text-muted")} data-testid="reply-counter">
                {formatNumber(editing.trim().length, locale)}/{formatNumber(limit, locale)}
              </span>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={startEdit}
            disabled={Boolean(blocked) || regenerating}
            className="group block w-full rounded-button text-start outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default"
            aria-label={t("engagement.queue.tapToEdit")}
            data-testid="reply-text"
          >
            {regenerating ? (
              <span className="flex items-center gap-2 py-1 text-body text-muted">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                {t("engagement.queue.regenerating")}
              </span>
            ) : reply.draftReply.trim() ? (
              <span className="block text-body whitespace-pre-line" dir="auto">
                {reply.draftReply}
              </span>
            ) : (
              <span className="block text-body text-muted italic">{t("engagement.queue.noPublicReply")}</span>
            )}
            {!blocked && !regenerating && (
              <span className="mt-1.5 flex items-center gap-1 text-caption font-semibold text-muted group-hover:text-foreground">
                <Pencil className="size-3" aria-hidden="true" />
                {t("engagement.queue.tapToEdit")}
              </span>
            )}
          </button>
        )}

        {reply.privateReply && (
          <div className="mt-2.5 text-caption text-muted">
            <p className="flex items-center gap-1.5">
              <Send className="size-3.5 shrink-0" aria-hidden="true" />
              {t("engagement.queue.withDm")}
            </p>
            <p className="mt-1 w-fit max-w-full rounded-[18px] bg-background px-3 py-1.5 text-body text-foreground" dir="auto">
              {reply.privateReply}
            </p>
          </div>
        )}

        {blocked && (
          <p className="mt-3 flex items-start gap-2 rounded-button bg-warning/15 p-2.5 text-caption font-semibold text-warning" role="status" data-testid="reply-blocked">
            <AlertTriangle className="mt-px size-4 shrink-0" aria-hidden="true" />
            {t(blocked === "dm_window_closed" ? "engagement.queue.blockedWindow" : "engagement.queue.blockedDeleted")}
          </p>
        )}

        {tones && editing === null && !blocked && (
          <div className="mt-3 flex flex-wrap gap-2" data-testid="regenerate-tones">
            <Button variant="outline" size="pill" onClick={() => (setTones(false), onRegenerate(null))}>
              {t("engagement.queue.tone.new")}
            </Button>
            {REGENERATE_TONES.map((tone) => (
              <Button key={tone} variant="outline" size="pill" onClick={() => (setTones(false), onRegenerate(tone))}>
                {t(`engagement.queue.tone.${tone}`)}
              </Button>
            ))}
          </div>
        )}
        {!isKeyword && !blocked && !regenerateAvailable && editing === null && (
          <p className="mt-2.5 text-caption text-muted" data-testid="regenerate-unavailable">
            {t("engagement.queue.regenerateUnavailable")}
          </p>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          {blocked ? (
            <Button variant="secondary" className="col-span-2" onClick={onDismiss}>
              {t("engagement.queue.remove")}
            </Button>
          ) : editing !== null ? (
            <>
              <Button variant="secondary" onClick={() => setEditing(null)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={() => onSend(editing.trim())} disabled={Boolean(problem)}>
                <Send className="size-3.5" />
                {t("engagement.queue.send")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={onDismiss} className={cn(isKeyword && "col-span-1")}>
                {t("engagement.queue.dismiss")}
              </Button>
              {!isKeyword && (
                <Button variant="secondary" onClick={() => setTones((v) => !v)} disabled={!regenerateAvailable || regenerating} aria-expanded={tones}>
                  <RefreshCw className={cn("size-3.5", regenerating && "animate-spin")} />
                  {t("engagement.queue.regenerate")}
                </Button>
              )}
              <Button onClick={() => onSend()} disabled={regenerating} className={cn(!isKeyword && "col-span-2 sm:col-span-1")}>
                <Send className="size-3.5" />
                {t("engagement.queue.send")}
              </Button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

// ── Sent ───────────────────────────────────────────────────────────────────────

const OUTCOME_STYLE = {
  as_is: { variant: "success", icon: Check },
  edited: { variant: "blue", icon: Pencil },
  manual: { variant: "neutral", icon: Pencil },
} as const;

/** How the AI drafts went out over the last days (as drafted, edited, written by hand): Reply settings. */
export function ReplySummaryCard() {
  const { t, locale } = useI18n();
  const summary = useReplySummary();
  if (!summary.data) return null;
  const s = summary.data;
  const total = s.ai.as_is + s.ai.edited + s.ai.manual;
  const share = (n: number) => (total ? `${(n / total) * 100}%` : "0%");

  return (
    <Card className="p-4" data-testid="reply-summary">
      <p className="text-caption font-semibold text-muted uppercase">{t("engagement.sent.period", { days: formatNumber(s.days, locale) })}</p>
      {total ? (
        <>
          <p className="mt-1 text-title font-semibold">{t("engagement.sent.rate", { rate: formatNumber(s.asIsRate ?? 0, locale) })}</p>
          <div className="mt-3 flex h-2 overflow-hidden rounded-pill bg-button-secondary" aria-hidden="true">
            <span className="bg-success" style={{ width: share(s.ai.as_is) }} />
            <span className="bg-primary" style={{ width: share(s.ai.edited) }} />
            <span className="bg-muted" style={{ width: share(s.ai.manual) }} />
          </div>
          <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted">
            <li className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-success" aria-hidden="true" />
              {t("engagement.sent.outcome.as_is")} · <span className="font-semibold text-foreground tabular-nums">{formatNumber(s.ai.as_is, locale)}</span>
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
              {t("engagement.sent.outcome.edited")} · <span className="font-semibold text-foreground tabular-nums">{formatNumber(s.ai.edited, locale)}</span>
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-muted" aria-hidden="true" />
              {t("engagement.sent.outcome.manual")} · <span className="font-semibold text-foreground tabular-nums">{formatNumber(s.ai.manual, locale)}</span>
            </li>
          </ul>
        </>
      ) : (
        <p className="mt-1 text-body text-muted">{t("engagement.sent.noneYet")}</p>
      )}
      {s.keyword > 0 && <p className="mt-2 text-caption text-muted">{t("engagement.sent.keyword", { count: formatNumber(s.keyword, locale) })}</p>}
    </Card>
  );
}

function SentReplies({
  sent,
  loading,
  error,
  onRetry,
}: {
  sent: ReplyDraftDto[] | undefined;
  loading: boolean;
  error: ApiClientError | null;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  if (loading) return <SkeletonList rows={3} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} className="m-4" />;
  if (!sent?.length) return <EmptyState icon={History} title={t("engagement.sent.empty")} hint={t("engagement.sent.emptyHint")} className="py-12" />;
  return (
    <ul className="divide-y divide-separator">
      {sent.map((reply) => (
        <SentReply key={reply.id} reply={reply} />
      ))}
    </ul>
  );
}

function SentReply({ reply }: { reply: ReplyDraftDto }) {
  const { t } = useI18n();
  const [showDraft, setShowDraft] = useState(false);
  const author = reply.commenterUsername || t("engagement.queue.dmCustomer");
  const style = reply.outcome ? OUTCOME_STYLE[reply.outcome] : null;
  const changed = reply.outcome === "edited" || reply.outcome === "manual";

  return (
    <li className="px-4 py-3.5" data-testid="sent-reply">
      <p className="flex flex-wrap items-center gap-x-1.5 text-caption text-muted">
        {reply.channel === "dm" ? <Send className="size-3.5" aria-hidden="true" /> : <MessagesSquare className="size-3.5" aria-hidden="true" />}
        <span className="font-semibold text-foreground">
          <bdi>{author}</bdi>
        </span>
        <span className="min-w-0 flex-1 truncate" dir="auto">
          {reply.commentText}
        </span>
      </p>
      <p className="mt-1.5 text-body whitespace-pre-line" dir="auto">
        {reply.draftReply || reply.privateReply}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-caption text-muted">
        {reply.keywordRule ? (
          <Badge variant="blue" size="sm">
            <Zap />
            {t("engagement.queue.keywordReply")}
          </Badge>
        ) : style ? (
          <Badge variant={style.variant} size="sm" data-testid="sent-outcome">
            <style.icon />
            {t(`engagement.sent.outcome.${reply.outcome}`)}
          </Badge>
        ) : null}
        {reply.sentAt && (
          <span className="flex items-center gap-1">
            <Clock className="size-3" aria-hidden="true" />
            <TimeAgo iso={reply.sentAt} />
          </span>
        )}
        {changed && !reply.keywordRule && (
          <button type="button" className="font-semibold text-primary" onClick={() => setShowDraft((v) => !v)} aria-expanded={showDraft}>
            {t(showDraft ? "engagement.sent.hideDraft" : "engagement.sent.showDraft")}
          </button>
        )}
      </div>
      {showDraft && (
        <p className="mt-2 rounded-card bg-secondary-bg p-2.5 text-caption text-muted" dir="auto">
          <span className="font-semibold">{t("engagement.sent.aiDraft")}</span> {reply.aiReply}
        </p>
      )}
    </li>
  );
}
