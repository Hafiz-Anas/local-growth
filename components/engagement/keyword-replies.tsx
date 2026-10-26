"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Images, MessageCircle, Pencil, Plus, Send, ShieldCheck, Trash2, Zap } from "lucide-react";
import { EmptyState, ErrorState, SkeletonList } from "@/components/shared/states";
import { TimeAgo } from "@/components/shared/time-ago";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api/client";
import { qk, useAction, useRules } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { cn, formatNumber } from "@/lib/utils";
import type { EngagementRuleDto } from "@/types";
import { RuleDialog, type RuleValues } from "./rule-dialog";

/** Engagement → Keyword replies: list, create, edit, delete and pause rules (feature engagement.dmRules). */
export function KeywordReplies() {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const rules = useRules();
  const [dialog, setDialog] = useState<{ open: boolean; rule: EngagementRuleDto | null }>({ open: false, rule: null });
  const [deleting, setDeleting] = useState<EngagementRuleDto | null>(null);

  const setRules = (update: (list: EngagementRuleDto[]) => EngagementRuleDto[]) => queryClient.setQueryData<EngagementRuleDto[]>(qk.rules, (list) => update(list ?? []));
  const save = useAction({
    mutationFn: ({ id, values }: { id: string | null; values: RuleValues }) =>
      id ? apiFetch<EngagementRuleDto>(`/api/engagement/rules/${id}`, { method: "PATCH", body: values }) : apiFetch<EngagementRuleDto>("/api/engagement/rules", { method: "POST", body: values }),
    onSuccess: (rule, { id }) => {
      setRules((list) => (id ? list.map((r) => (r.id === id ? rule : r)) : [...list, rule]));
      setDialog({ open: false, rule: null });
    },
  });
  const toggle = useAction({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => apiFetch<EngagementRuleDto>(`/api/engagement/rules/${id}`, { method: "PATCH", body: { active } }),
    onMutate: async ({ id, active }) => {
      await queryClient.cancelQueries({ queryKey: qk.rules });
      const previous = queryClient.getQueryData<EngagementRuleDto[]>(qk.rules);
      setRules((list) => list.map((r) => (r.id === id ? { ...r, active } : r)));
      return { previous };
    },
    onError: (_e, _v, context) => queryClient.setQueryData(qk.rules, context?.previous),
  });
  const remove = useAction({
    mutationFn: (id: string) => apiFetch(`/api/engagement/rules/${id}`, { method: "DELETE" }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: qk.rules });
      const previous = queryClient.getQueryData<EngagementRuleDto[]>(qk.rules);
      setRules((list) => list.filter((r) => r.id !== id));
      return { previous };
    },
    onError: (_e, _v, context) => queryClient.setQueryData(qk.rules, context?.previous),
    // Its approval drafts were dismissed on the server.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.replies }),
  });

  const list = rules.data ?? [];

  return (
    <Card>
      <CardHeader className="border-b border-separator">
        <div>
          <CardTitle>{t("engagement.rules.listTitle")}</CardTitle>
          <CardDescription>{t("engagement.rules.limits")}</CardDescription>
        </div>
        <Button size="sm" onClick={() => setDialog({ open: true, rule: null })}>
          <Plus className="size-4" />
          {t("engagement.rules.add")}
        </Button>
      </CardHeader>

      {rules.isPending ? (
        <SkeletonList rows={3} />
      ) : rules.isError ? (
        <ErrorState error={rules.error} onRetry={() => rules.refetch()} className="m-4" />
      ) : list.length === 0 ? (
        <EmptyState
          icon={Zap}
          title={t("engagement.rules.emptyTitle")}
          hint={t("engagement.rules.empty")}
          action={
            <Button onClick={() => setDialog({ open: true, rule: null })}>
              <Plus className="size-4" />
              {t("engagement.rules.addFirst")}
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-separator" aria-label={t("engagement.rules.title")}>
          {list.map((rule) => (
            <li key={rule.id} className={cn("flex flex-col gap-3 px-4 py-4 md:flex-row md:items-start", !rule.active && "opacity-60")} data-testid="keyword-rule">
              <div className="min-w-0 flex-1 space-y-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  {rule.keywords.map((k) => (
                    <span key={k} className="rounded-pill border border-border px-2.5 py-0.5 text-caption font-semibold" dir="auto">
                      <bdi>{k}</bdi>
                    </span>
                  ))}
                  <span className="text-caption text-muted">
                    · {t(rule.matchType === "exact" ? "engagement.rules.match.exact" : "engagement.rules.match.word")}
                  </span>
                </div>

                <div className="space-y-1.5">
                  {rule.commentReply ? (
                    <p className="flex items-start gap-2 text-body">
                      <MessageCircle className="mt-0.5 size-4 shrink-0 text-muted" aria-label={t("engagement.rules.reply")} />
                      <span className="w-fit max-w-full rounded-[18px] bg-button-secondary px-3.5 py-1.5" dir="auto">
                        {rule.commentReply}
                      </span>
                    </p>
                  ) : (
                    <p className="text-caption text-warning">{t("engagement.rules.noPublicReply")}</p>
                  )}
                  {rule.dmMessage && (
                    <p className="flex items-start gap-2 text-body">
                      <Send className="mt-0.5 size-4 shrink-0 text-muted" aria-label={t("engagement.rules.dm")} />
                      <span className="w-fit max-w-full rounded-[18px] bg-button-secondary px-3.5 py-1.5" dir="auto">
                        {rule.dmMessage}
                      </span>
                    </p>
                  )}
                </div>

                <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-caption text-muted">
                  <span>{t("engagement.rules.triggered", { count: formatNumber(rule.timesTriggered, locale) })}</span>
                  <span aria-hidden="true">·</span>
                  {rule.lastTriggeredAt ? (
                    <span>
                      {t("engagement.rules.lastTriggered")} <TimeAgo iso={rule.lastTriggeredAt} />
                    </span>
                  ) : (
                    <span>{t("engagement.rules.neverTriggered")}</span>
                  )}
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <Images className="size-3.5" aria-hidden="true" />
                    {rule.scope === "selected" ? t("engagement.rules.scopeCount", { count: rule.mediaIds.length }) : t("engagement.rules.scopeAll")}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    {rule.autoSend ? <Zap className="size-3.5" aria-hidden="true" /> : <ShieldCheck className="size-3.5" aria-hidden="true" />}
                    {rule.autoSend ? t("engagement.rules.automatic") : t("engagement.rules.needsApproval")}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{rule.active ? t("common.active") : t("common.paused")}</span>
                </p>
              </div>

              <div className="flex items-center gap-1 self-end md:self-start">
                <Button variant="ghost" size="icon-sm" aria-label={t("common.edit")} onClick={() => setDialog({ open: true, rule })}>
                  <Pencil strokeWidth={1.75} />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={t("engagement.rules.delete")} onClick={() => setDeleting(rule)}>
                  <Trash2 strokeWidth={1.75} />
                </Button>
                <Switch
                  className="ms-1"
                  checked={rule.active}
                  onCheckedChange={(active) => toggle.mutate({ id: rule.id, active })}
                  aria-label={rule.active ? t("engagement.rules.pause") : t("engagement.rules.resume")}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      <RuleDialog
        rule={dialog.rule}
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        onSave={(values) => save.mutate({ id: dialog.rule?.id ?? null, values })}
        onDelete={dialog.rule ? () => setDeleting(dialog.rule) : undefined}
        saving={save.isPending}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("engagement.rules.deleteTitle")}
        description={t("engagement.rules.deleteBody")}
        confirmLabel={t("engagement.rules.delete")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id);
          setDialog({ open: false, rule: null });
        }}
      />
    </Card>
  );
}
