"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Palette, Send, ShieldCheck } from "lucide-react";
import { useActiveClient, useFeature } from "@/components/providers/active-client-provider";
import { FeatureToggle } from "@/components/shared/feature-toggle";
import { PageHeader, SectionTitle } from "@/components/shared/page-header";
import { ErrorState, Skeleton } from "@/components/shared/states";
import { StatTile } from "@/components/shared/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { SHOW_AUTO_REPLY } from "@/config/engagement";
import { apiFetch } from "@/lib/api/client";
import { qk, useAction, useEngagement, useReplies, useRules } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { formatNumber } from "@/lib/utils";
import type { EngagementDto } from "@/types";
import { KeywordReplies } from "./keyword-replies";
import { ReplyQueue, ReplySummaryCard, replyKind } from "./reply-queue";

/*
 * Engagement, one view per tab (config/navigation.ts): Comment replies · DM replies · Keyword
 * replies · Reply settings. Each tab opens with one sentence on what it does and when it runs, and
 * the on/off status of its automation. Every card lives in exactly one tab.
 */

type Settings = EngagementDto["settings"];
type Status = { tone: "on" | "off" | "attention"; label: string; hint: string };

const STATUS_VARIANT = { on: "success", off: "neutral", attention: "warning" } as const;

function TabIntro({ title, intro, status }: { title: string; intro: string; status: Status | null }) {
  return (
    <div className="mb-6">
      <PageHeader title={title} subtitle={intro} className="mb-3" />
      {status && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted" role="status" data-testid="automation-status" data-status={status.tone}>
          <Badge variant={STATUS_VARIANT[status.tone]}>
            <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
            {status.label}
          </Badge>
          <span>{status.hint}</span>
        </p>
      )}
    </div>
  );
}

/** Replies only arrive while Instagram is connected and its login still works; otherwise why not, for the status line. */
function useInstagramProblem(): "connectFirst" | "reconnect" | null {
  const { client } = useActiveClient();
  if (client.connection === "disconnected") return "connectFirst";
  return client.instagramIssue ? "reconnect" : null;
}

function pausedStatus(t: (key: string) => string, problem: "connectFirst" | "reconnect"): Status {
  return { tone: "attention", label: t("engagement.status.paused"), hint: t(`engagement.status.${problem}`) };
}

// ── Comment replies / DM replies ─────────────────────────────────────────────

export function CommentRepliesView() {
  return <AiRepliesTab kind="comment" />;
}

export function DmRepliesView() {
  return <AiRepliesTab kind="dm" />;
}

function AiRepliesTab({ kind }: { kind: "comment" | "dm" }) {
  const { t, locale } = useI18n();
  const problem = useInstagramProblem();
  const engagement = useEngagement();
  const replies = useReplies();
  const name = kind === "dm" ? "dmReplies" : "commentReplies";
  const waiting = replies.data?.filter((r) => replyKind(r) === kind && !r.blocked).length;
  const stats = engagement.data?.stats;
  const today = kind === "dm" ? stats?.dmsSent : stats?.commentsToday;

  const status: Status = problem ? pausedStatus(t, problem) : { tone: "on", label: t("engagement.status.on"), hint: t(`engagement.${name}.statusOn`) };

  return (
    // Phones: the replies come first, today's numbers after them.
    <div className="flex flex-col">
      <TabIntro title={t(`engagement.${name}.title`)} intro={t(`engagement.${name}.intro`)} status={status} />
      <div className="order-2 mt-6 grid grid-cols-2 gap-3 md:order-none md:mt-0 md:mb-6">
        <StatTile
          icon={kind === "dm" ? Send : MessageCircle}
          label={t(kind === "dm" ? "engagement.stats.dmsSent" : "engagement.stats.commentsToday")}
          value={today === undefined ? "–" : formatNumber(today, locale)}
        />
        <StatTile icon={ShieldCheck} label={t("engagement.stats.awaiting")} value={waiting === undefined ? "–" : formatNumber(waiting, locale)} accent={Boolean(waiting)} />
      </div>
      <ReplyQueue kind={kind} connected={problem !== "connectFirst"} />
    </div>
  );
}

// ── Keyword replies ──────────────────────────────────────────────────────────

export function KeywordRepliesView() {
  const { t, locale } = useI18n();
  const problem = useInstagramProblem();
  const rules = useRules();
  const replies = useReplies();
  const list = rules.data ?? [];
  const active = list.filter((r) => r.active).length;
  // The approval queue only matters when a rule needs approval or a keyword reply is still waiting.
  const showQueue = list.some((r) => !r.autoSend) || Boolean(replies.data?.some((r) => replyKind(r) === "keyword"));

  let status: Status | null = null;
  if (rules.data) {
    if (!list.length) status = { tone: "off", label: t("engagement.status.off"), hint: t("engagement.keywordReplies.statusNone") };
    else if (!active) status = { tone: "off", label: t("engagement.status.off"), hint: t("engagement.keywordReplies.statusPaused") };
    else if (problem) status = pausedStatus(t, problem);
    else status = { tone: "on", label: t("engagement.status.on"), hint: t("engagement.keywordReplies.statusOn", { count: formatNumber(active, locale) }) };
  }

  return (
    <div>
      <TabIntro title={t("engagement.keywordReplies.title")} intro={t("engagement.keywordReplies.intro")} status={status} />
      <KeywordReplies />
      {showQueue && (
        <section className="mt-8">
          <SectionTitle>{t("engagement.keywordReplies.approvals")}</SectionTitle>
          <ReplyQueue kind="keyword" connected={problem !== "connectFirst"} />
        </section>
      )}
    </div>
  );
}

// ── Reply settings ───────────────────────────────────────────────────────────

export function ReplySettingsView() {
  const { t } = useI18n();
  // Hidden while auto-sending doesn't exist (config/engagement.ts): every reply then waits for approval.
  const canAutoReply = useFeature("engagement.autoReply") && SHOW_AUTO_REPLY;
  const canBrandVoice = useFeature("settings.brandVoice");
  const queryClient = useQueryClient();
  const engagement = useEngagement();
  const [confirmAuto, setConfirmAuto] = useState(false);

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

  if (engagement.isPending) return <SettingsSkeleton />;
  if (engagement.isError) return <ErrorState error={engagement.error} onRetry={() => engagement.refetch()} />;

  const autoReply = canAutoReply && (engagement.data.settings.autoReply ?? false);
  const status: Status = autoReply
    ? { tone: "on", label: t("engagement.controls.autoReply"), hint: t("engagement.controls.autoReplyHint") }
    : { tone: "off", label: t("engagement.controls.manualApproval"), hint: t("engagement.controls.manualApprovalHint") };

  function setAutoReply(on: boolean) {
    if (on) setConfirmAuto(true);
    else updateSettings.mutate({ autoReply: false });
  }

  return (
    <div>
      <TabIntro title={t("engagement.replySettings.title")} intro={t("engagement.replySettings.intro")} status={status} />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-0">
            <CardTitle>{t("engagement.controls.title")}</CardTitle>
          </CardHeader>
          <div className="divide-y divide-separator px-4 pb-1">
            <FeatureToggle
              label={t("engagement.controls.manualApproval")}
              description={canAutoReply || !SHOW_AUTO_REPLY ? t("engagement.controls.manualApprovalHint") : t("engagement.controls.manualApprovalLocked")}
              checked={!autoReply}
              disabled={!canAutoReply}
              onCheckedChange={(v) => setAutoReply(!v)}
            />
            {canAutoReply && (
              <FeatureToggle label={t("engagement.controls.autoReply")} description={t("engagement.controls.autoReplyHint")} checked={autoReply} onCheckedChange={setAutoReply} />
            )}
          </div>
        </Card>

        <div className="grid gap-6">
          <ReplySummaryCard />
          {canBrandVoice && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Palette className="size-4" aria-hidden="true" />
                    {t("engagement.replySettings.toneTitle")}
                  </CardTitle>
                  <CardDescription>{t("engagement.replySettings.toneHint")}</CardDescription>
                </div>
              </CardHeader>
              <div className="px-4 pb-4">
                <Button variant="secondary" asChild>
                  <Link href="/settings">{t("engagement.replySettings.toneLink")}</Link>
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>

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

function SettingsSkeleton() {
  return (
    <div aria-busy="true">
      <div className="mb-6 space-y-2.5">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-52 rounded-panel" />
        <Skeleton className="h-52 rounded-panel" />
      </div>
    </div>
  );
}
