"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, MessageCircle, MessagesSquare, Pencil, Plus, Send, ShieldCheck, Sparkles, Zap } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api/client";
import { qk, useAction, useEngagement, useReplies, useRules } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { cn, formatNumber, initials, toneFor } from "@/lib/utils";
import { notify } from "@/store/ui-store";
import type { EngagementDto, EngagementRuleDto, ReplyDraftDto } from "@/types";
import { RuleDialog, type RuleValues } from "./rule-dialog";

type Settings = EngagementDto["settings"];

export function EngagementView() {
  const { client } = useActiveClient();
  const { t, locale } = useI18n();
  const canRules = useFeature("engagement.dmRules");
  const canReplies = useFeature("engagement.aiReplies");
  const canAutoReply = useFeature("engagement.autoReply");
  const canWhatsapp = useFeature("engagement.whatsappPricing");
  const queryClient = useQueryClient();

  const engagement = useEngagement();
  const rules = useRules(canRules);
  const replies = useReplies(canReplies);

  const [confirmAuto, setConfirmAuto] = useState(false);
  const [ruleDialog, setRuleDialog] = useState<{ open: boolean; rule: EngagementRuleDto | null }>({ open: false, rule: null });
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
    mutationFn: ({ id, text }: { id: string; text?: string }) =>
      apiFetch<ReplyDraftDto>(`/api/reply-drafts/${id}/approve`, { method: "POST", body: text ? { draftReply: text } : {} }),
    onMutate: ({ id }) => removeReply(id),
    onError: restoreReplies,
    onSuccess: () => {
      setEditing(null);
      notify.success(t("engagement.queue.posted"));
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

  // Rules ---------------------------------------------------------------------
  const setRules = (update: (list: EngagementRuleDto[]) => EngagementRuleDto[]) =>
    queryClient.setQueryData<EngagementRuleDto[]>(qk.rules, (list) => update(list ?? []));
  const saveRule = useAction({
    mutationFn: ({ id, values }: { id: string | null; values: RuleValues }) =>
      id
        ? apiFetch<EngagementRuleDto>(`/api/engagement/rules/${id}`, { method: "PATCH", body: values })
        : apiFetch<EngagementRuleDto>("/api/engagement/rules", { method: "POST", body: values }),
    onSuccess: (rule, { id }) => {
      setRules((list) => (id ? list.map((r) => (r.id === id ? rule : r)) : [...list, rule]));
      setRuleDialog({ open: false, rule: null });
    },
  });
  const toggleRule = useAction({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => apiFetch<EngagementRuleDto>(`/api/engagement/rules/${id}`, { method: "PATCH", body: { active } }),
    onMutate: async ({ id, active }) => {
      await queryClient.cancelQueries({ queryKey: qk.rules });
      const previous = queryClient.getQueryData<EngagementRuleDto[]>(qk.rules);
      setRules((list) => list.map((r) => (r.id === id ? { ...r, active } : r)));
      return { previous };
    },
    onError: (_e, _v, context) => queryClient.setQueryData(qk.rules, context?.previous),
  });
  const deleteRule = useAction({
    mutationFn: (id: string) => apiFetch(`/api/engagement/rules/${id}`, { method: "DELETE" }),
    onSuccess: (_d, id) => {
      setRules((list) => list.filter((r) => r.id !== id));
      setRuleDialog({ open: false, rule: null });
    },
  });

  if (engagement.isPending) return <EngagementSkeleton />;
  if (engagement.isError) return <ErrorState error={engagement.error} onRetry={() => engagement.refetch()} />;

  const { stats, settings } = engagement.data;
  const autoReply = settings.autoReply ?? false;
  const useWhatsapp = canWhatsapp && Boolean(settings.priceQuestionsToWhatsApp);
  const whatsappNumber = settings.whatsappNumber ?? client.whatsappNumber;
  const whatsappLink = `wa.me/${whatsappNumber.replace(/\D/g, "")}`;
  const queue = replies.data ?? [];
  const ruleList = rules.data ?? [];

  /** Price questions get the WhatsApp answer when that setting is on (unless the draft was edited). */
  function replyFor(reply: ReplyDraftDto) {
    if (reply.isPriceQuestion && useWhatsapp && whatsappNumber) return t(`engagement.whatsappReply.${reply.language}`, { link: whatsappLink });
    return reply.draftReply;
  }

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
        {canReplies && <StatTile icon={ShieldCheck} label={t("engagement.stats.awaiting")} value={replies.data ? queue.length : "–"} accent={queue.length > 0} />}
        {canRules && <StatTile icon={Zap} label={t("engagement.stats.activeRules")} value={rules.data ? ruleList.filter((r) => r.active).length : "–"} />}
      </div>

      <div className={cn("mb-8 grid gap-6", canReplies && "lg:grid-cols-[1fr_320px]")}>
        {canReplies && (
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
                  const reply = replyFor(comment);
                  const viaWhatsapp = reply !== comment.draftReply;
                  const isEditing = editing?.id === comment.id;
                  return (
                    <li key={comment.id} className="px-4 py-4">
                      {comment.postCaption && (
                        <p className="mb-2.5 truncate text-caption text-muted">
                          {t("engagement.queue.on")} “<bdi>{comment.postCaption}</bdi>”
                        </p>
                      )}
                      <CommentRow
                        author={comment.commenterUsername}
                        avatarUrl={comment.commenterAvatarUrl}
                        initials={initials(comment.commenterUsername.replace(/[._]/g, " "))}
                        tone={toneFor(comment.commenterUsername)}
                        text={comment.commentText}
                        meta={
                          <>
                            <TimeAgo iso={comment.createdAt} />
                            {comment.likes > 0 && <span>{t(comment.likes === 1 ? "common.like" : "common.likes", { count: comment.likes })}</span>}
                            <span>{t("common.reply")}</span>
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
                            <Badge variant="blue" size="sm">
                              <Sparkles />
                              {t("engagement.queue.aiDraft")}
                            </Badge>
                          }
                          textSlot={
                            isEditing ? (
                              <Textarea value={editing.text} onChange={(e) => setEditing({ id: comment.id, text: e.target.value })} rows={3} dir="auto" autoFocus />
                            ) : undefined
                          }
                          meta={
                            <>
                              <span>{comment.language === "ar" ? t("engagement.queue.kuwaiti") : t("engagement.queue.english")}</span>
                              {viaWhatsapp && <span className="text-success">{t("engagement.queue.whatsapp")}</span>}
                            </>
                          }
                        />
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
                              <Button onClick={() => approve.mutate({ id: comment.id, text: viaWhatsapp ? reply : undefined })}>{t("engagement.queue.approve")}</Button>
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
            {canWhatsapp && (
              <FeatureToggle
                label={t("engagement.controls.priceWhatsapp")}
                description={t("engagement.controls.priceWhatsappHint")}
                checked={Boolean(settings.priceQuestionsToWhatsApp)}
                onCheckedChange={(v) => updateSettings.mutate({ priceQuestionsToWhatsApp: v })}
              />
            )}
          </div>
        </Card>
      </div>

      {canRules && (
        <Card>
          <CardHeader className="border-b border-separator">
            <div>
              <CardTitle>{t("engagement.rules.title")}</CardTitle>
              <CardDescription>{t("engagement.rules.subtitle")}</CardDescription>
              {client.instagramProvider === "meta" && <CardDescription className="mt-1 text-warning">{t("instagramConnect.notes.dms")}</CardDescription>}
            </div>
            <Button size="sm" onClick={() => setRuleDialog({ open: true, rule: null })}>
              <Plus className="size-4" />
              {t("engagement.rules.add")}
            </Button>
          </CardHeader>
          {rules.isPending ? (
            <SkeletonList rows={3} />
          ) : rules.isError ? (
            <ErrorState error={rules.error} onRetry={() => rules.refetch()} className="m-4" />
          ) : ruleList.length === 0 ? (
            <EmptyState icon={Zap} title={t("engagement.rules.emptyTitle")} hint={t("engagement.rules.empty")} />
          ) : (
            <ul className="divide-y divide-separator">
              {ruleList.map((rule) => (
                <li key={rule.id} className={cn("flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center", !rule.active && "opacity-60")}>
                  <div className="flex flex-wrap items-center gap-1.5 md:w-56 md:shrink-0">
                    {rule.keywords.map((k) => (
                      <span key={k} className="rounded-pill border border-border px-2.5 py-0.5 text-caption font-semibold" dir="auto">
                        {k}
                      </span>
                    ))}
                  </div>
                  <ArrowRight className="hidden size-4 shrink-0 text-muted md:block rtl:-scale-x-100" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="w-fit max-w-full rounded-[18px] bg-button-secondary px-3.5 py-2 text-body" dir="auto">
                      {rule.dmMessage}
                    </p>
                    <p className="mt-1.5 text-caption text-muted">
                      {t("engagement.rules.triggered", { count: formatNumber(rule.timesTriggered, locale) })} · {rule.active ? t("common.active") : t("common.paused")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 self-end md:self-center">
                    <Button variant="ghost" size="icon-sm" aria-label={t("common.edit")} onClick={() => setRuleDialog({ open: true, rule })}>
                      <Pencil strokeWidth={1.75} />
                    </Button>
                    <Switch
                      checked={rule.active}
                      onCheckedChange={(active) => toggleRule.mutate({ id: rule.id, active })}
                      aria-label={rule.active ? t("engagement.rules.pause") : t("engagement.rules.resume")}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <ConfirmDialog
        open={confirmAuto}
        onOpenChange={setConfirmAuto}
        title={t("engagement.controls.confirmTitle")}
        description={t("engagement.controls.confirmBody")}
        confirmLabel={t("engagement.controls.confirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => updateSettings.mutate({ autoReply: true })}
      />
      <RuleDialog
        rule={ruleDialog.rule}
        open={ruleDialog.open}
        onOpenChange={(open) => setRuleDialog((d) => ({ ...d, open }))}
        onSave={(values) => saveRule.mutate({ id: ruleDialog.rule?.id ?? null, values })}
        onDelete={ruleDialog.rule ? () => deleteRule.mutate(ruleDialog.rule!.id) : undefined}
        saving={saveRule.isPending || deleteRule.isPending}
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
