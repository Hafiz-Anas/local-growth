"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Send, ShieldCheck, Zap } from "lucide-react";
import { useFeature } from "@/components/providers/active-client-provider";
import { FeatureToggle } from "@/components/shared/feature-toggle";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, Skeleton, SkeletonList } from "@/components/shared/states";
import { StatTile } from "@/components/shared/stat-tile";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api/client";
import { qk, useAction, useEngagement, useReplies, useRules } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { cn, formatNumber } from "@/lib/utils";
import type { EngagementDto } from "@/types";
import { KeywordReplies } from "./keyword-replies";
import { ReplyQueue } from "./reply-queue";

type Settings = EngagementDto["settings"];

export function EngagementView() {
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

  if (engagement.isPending) return <EngagementSkeleton />;
  if (engagement.isError) return <ErrorState error={engagement.error} onRetry={() => engagement.refetch()} />;

  const { stats, settings } = engagement.data;
  const autoReply = settings.autoReply ?? false;
  const waiting = replies.data?.filter((r) => !r.blocked).length ?? 0;
  const ruleList = rules.data ?? [];

  function setAutoReply(on: boolean) {
    if (on) setConfirmAuto(true);
    else updateSettings.mutate({ autoReply: false });
  }

  return (
    // Phones: the reply queue comes first, today's numbers after it.
    <div className="flex flex-col">
      <PageHeader title={t("engagement.title")} subtitle={t("engagement.subtitle")} />

      <div className="order-2 mb-8 grid grid-cols-2 gap-3 md:order-none lg:grid-cols-4">
        <StatTile icon={MessageCircle} label={t("engagement.stats.commentsToday")} value={formatNumber(stats.commentsToday, locale)} />
        <StatTile icon={Send} label={t("engagement.stats.dmsSent")} value={formatNumber(stats.dmsSent, locale)} />
        {canQueue && <StatTile icon={ShieldCheck} label={t("engagement.stats.awaiting")} value={replies.data ? waiting : "–"} accent={waiting > 0} />}
        {canRules && <StatTile icon={Zap} label={t("engagement.stats.activeRules")} value={rules.data ? ruleList.filter((r) => r.active).length : "–"} />}
      </div>

      <div className={cn("order-1 mb-8 grid gap-6 md:order-none", canQueue && "lg:grid-cols-[1fr_320px]")}>
        {canQueue && <ReplyQueue />}

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

      {canRules && (
        <div className="order-3 md:order-none">
          <KeywordReplies />
        </div>
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
