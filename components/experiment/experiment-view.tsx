"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, FlaskConical, Lightbulb, Loader2, Send, Target, Trash2 } from "lucide-react";
import { useActiveClient, useFeature } from "@/components/providers/active-client-provider";
import { ChangeIndicator } from "@/components/shared/change-indicator";
import { MediaPlaceholder } from "@/components/shared/media";
import { SectionTitle } from "@/components/shared/page-header";
import { EmptyState, ErrorState, Skeleton, SkeletonCard } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/provider";
import { cn, formatDateTime, formatNumber, formatPct, hourLabel } from "@/lib/utils";
import { apiFetch } from "@/lib/api/client";
import { qk, useAction, useExperiment, useScheduled } from "@/lib/api/queries";
import { notify } from "@/store/ui-store";
import type { PostWindow, ScheduledPostDto, WindowResult } from "@/types";
import { EngagementHeatmap } from "./heatmap";

const MIN_CONFIDENCE_TO_APPLY = 60;

export function ExperimentView() {
  const { t, locale } = useI18n();
  const showQueue = useFeature("experiment.scheduleQueue");
  const queryClient = useQueryClient();
  const experiment = useExperiment();
  const scheduled = useScheduled(showQueue);
  const { client } = useActiveClient();
  const [confirmPublish, setConfirmPublish] = useState<string | null>(null);

  const publish = useAction({
    mutationFn: (id: string) => apiFetch<{ published: boolean; mediaId: string }>(`/api/scheduled-posts/${id}/publish`, { method: "POST" }),
    onSuccess: () => notify.success(t("publish.published")),
    // On failure the post stays in the queue at its time; either way, refresh the queue and drafts.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.scheduled });
      queryClient.invalidateQueries({ queryKey: qk.drafts });
    },
  });

  const apply = useAction({
    mutationFn: (window: PostWindow) =>
      apiFetch<{ window: PostWindow; moved: number; queue: ScheduledPostDto[] }>("/api/experiment/apply-window", { method: "POST", body: { window } }),
    onSuccess: (result) => {
      queryClient.setQueryData(qk.scheduled, result.queue);
      notify.success(t("experiment.appliedToast", { count: result.moved, window: t(`windows.${result.window}`) }));
    },
  });
  const remove = useAction({
    mutationFn: (id: string) => apiFetch(`/api/scheduled-posts/${id}`, { method: "DELETE" }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: qk.scheduled });
      const previous = queryClient.getQueryData<ScheduledPostDto[]>(qk.scheduled);
      queryClient.setQueryData<ScheduledPostDto[]>(qk.scheduled, (list) => list?.filter((p) => p.id !== id));
      return { previous };
    },
    onError: (_e, _id, context) => queryClient.setQueryData(qk.scheduled, context?.previous),
    // The cancelled post's draft is back among the drafts.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.drafts }),
  });

  if (experiment.isPending) return <ExperimentSkeleton />;
  if (experiment.isError) return <ErrorState error={experiment.error} onRetry={() => experiment.refetch()} />;
  const data = experiment.data;
  if (!data) return <EmptyState icon={FlaskConical} title={t("experiment.noneTitle")} hint={t("experiment.noneHint")} className="rounded-panel border border-border" />;

  // Sections are present only when their features are ON.
  const windows = data.windows ?? [];
  const opportunity = data.opportunity ?? null;
  const showWindows = windows.length > 0;
  const showHeatmap = Boolean(data.heatmap);
  const queue = scheduled.data ?? [];
  const best = opportunity ? windows.find((w) => w.id === opportunity.window) : undefined;
  const maxReach = Math.max(1, ...windows.map((w) => w.avgReach));
  const conclusive = Boolean(opportunity && opportunity.confidencePct >= MIN_CONFIDENCE_TO_APPLY);
  // "Applied" = every upcoming post already sits in the suggested window.
  const isApplied = Boolean(opportunity && queue.length > 0 && queue.every((p) => p.window === opportunity.window));

  return (
    <div>
      <header className="mb-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {data.status === "running" ? (
            <Badge variant="gradient">
              <span className="size-1.5 animate-pulse rounded-pill bg-white" aria-hidden="true" />
              {t("experiment.live")}
            </Badge>
          ) : (
            <Badge variant="neutral">{t(`experiment.status.${data.status}`)}</Badge>
          )}
          <Badge variant="outline">
            {t("experiment.daysSampled", { count: data.daysSampled })} {t("experiment.ofDays", { count: data.daysPlanned })}
          </Badge>
          <Badge variant="outline">
            <Target />
            {t("experiment.dailyTarget")}: {t("experiment.postsPerDay", { count: data.dailyTarget })}
          </Badge>
        </div>
        <h1 className="text-display font-bold tracking-tight">{t("experiment.question")}</h1>
        <p className="mt-2 max-w-2xl text-body text-muted">{t("experiment.subtitle")}</p>
        <div className="mt-3 h-1 max-w-sm overflow-hidden rounded-pill bg-border" aria-hidden="true">
          <div className="h-full bg-ig-gradient" style={{ width: `${(data.daysSampled / data.daysPlanned) * 100}%` }} />
        </div>
      </header>

      {showWindows && (
        <>
          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-caption text-muted">
              {t("experiment.baseline", { value: formatNumber(data.baselineReach, locale) })}
            </p>
          </div>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            {windows.map((w) => (
              <WindowCard key={w.id} result={w} best={w.id === best?.id} maxReach={maxReach} baseline={data.baselineReach} />
            ))}
          </div>

          {opportunity && (
          <Card className="mb-8 overflow-hidden border-transparent bg-ig-gradient p-px">
            <div className="flex flex-col gap-4 rounded-[11px] bg-background p-4 sm:flex-row sm:items-center">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-pill bg-ig-gradient text-white">
                <Lightbulb className="size-6" strokeWidth={1.75} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-title font-bold">{t("experiment.opportunity")}</p>
                <p className="mt-0.5 text-body">
                  {t("experiment.opportunityBody", {
                    window: t(`windows.${opportunity.window}`),
                    lift: formatPct(opportunity.liftPct),
                  })}
                </p>
                <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-caption">
                  <div className="flex gap-1">
                    <dt className="text-muted">{t("experiment.sampleSize")}:</dt>
                    <dd className="font-semibold">{t("experiment.samplePosts", { count: opportunity.sampleSize })}</dd>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <dt className="text-muted">{t("experiment.confidence")}:</dt>
                    <dd className="flex items-center gap-1.5 font-semibold">
                      <span className="h-1 w-14 overflow-hidden rounded-pill bg-border" aria-hidden="true">
                        <span className="block h-full bg-foreground" style={{ width: `${opportunity.confidencePct}%` }} />
                      </span>
                      {opportunity.confidencePct}%
                    </dd>
                  </div>
                </dl>
                {!conclusive && <p className="mt-2 text-caption text-warning">{t("experiment.lowConfidence")}</p>}
              </div>
              <Button
                size="md"
                variant={isApplied ? "secondary" : "primary"}
                disabled={!conclusive || isApplied || apply.isPending}
                onClick={() => apply.mutate(opportunity.window)}
              >
                {apply.isPending ? <Loader2 className="size-4 animate-spin" /> : isApplied && <Check className="size-4" />}
                {isApplied ? t("experiment.applied") : t("experiment.apply")}
              </Button>
            </div>
          </Card>
          )}
        </>
      )}

      {showHeatmap && (
        <Card className="mb-8">
          <CardHeader>
            <div>
              <CardTitle>{t("experiment.heatmap")}</CardTitle>
              <CardDescription>{t("experiment.heatmapHint")}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <EngagementHeatmap data={data.heatmap!} />
          </CardContent>
        </Card>
      )}

      {showQueue && (
        <section>
          <SectionTitle>{t("experiment.queue")}</SectionTitle>
          {scheduled.isPending ? (
            <Skeleton className="h-40 rounded-panel" />
          ) : scheduled.isError ? (
            <ErrorState error={scheduled.error} onRetry={() => scheduled.refetch()} />
          ) : queue.length === 0 ? (
            <EmptyState icon={CalendarDays} title={t("experiment.queueEmptyTitle")} hint={t("experiment.queueEmpty")} className="rounded-card border border-dashed border-border" />
          ) : (
            <ul className="divide-y divide-separator rounded-panel border border-border">
              {queue.map((post) => (
                <li key={post.id} className="flex items-center gap-3 px-4 py-3">
                  <MediaPlaceholder tone={post.tone} icon={post.icon} className="size-11 shrink-0 rounded-button" iconClassName="size-5" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-semibold">
                      <bdi>{post.caption}</bdi>
                    </p>
                    <p className="truncate text-caption text-muted">
                      {formatDateTime(post.scheduledFor, locale, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                      {" · "}
                      {post.source === "generator" ? t("experiment.fromGenerator") : t("experiment.manual")}
                    </p>
                  </div>
                  <Badge variant={post.window === opportunity?.window ? "blue" : "neutral"} className="hidden sm:inline-flex">
                    {t(`windows.${post.window}`)}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setConfirmPublish(post.id)}
                    disabled={publish.isPending}
                    aria-label={t("publish.now")}
                    title={t("publish.now")}
                  >
                    {publish.isPending && publish.variables === post.id ? <Loader2 className="animate-spin" /> : <Send strokeWidth={1.75} />}
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => remove.mutate(post.id)} disabled={publish.isPending && publish.variables === post.id} aria-label={t("common.remove")}>
                    <Trash2 strokeWidth={1.75} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <ConfirmDialog
        open={confirmPublish !== null}
        onOpenChange={(open) => !open && setConfirmPublish(null)}
        title={t("publish.confirmTitle")}
        description={t("publish.confirmBody", { handle: client.handle })}
        confirmLabel={t("publish.confirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => confirmPublish && publish.mutate(confirmPublish)}
      />
    </div>
  );
}

function ExperimentSkeleton() {
  return (
    <div aria-busy="true">
      <div className="mb-6 space-y-3">
        <div className="flex gap-2">
          <Skeleton className="h-6 w-28 rounded-pill" />
          <Skeleton className="h-6 w-36 rounded-pill" />
        </div>
        <Skeleton className="h-8 w-96 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-44 rounded-panel" />
        ))}
      </div>
      <SkeletonCard lines={6} />
    </div>
  );
}

function WindowCard({ result, best, maxReach, baseline }: { result: WindowResult; best: boolean; maxReach: number; baseline: number }) {
  const { t, locale } = useI18n();
  return (
    <div className={cn("rounded-panel border bg-background p-4", best ? "border-foreground" : "border-border")}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-body font-bold">{t(`windows.${result.id}`)}</p>
          <p className="text-caption text-muted">
            <span dir="ltr">
              {hourLabel(result.startHour, locale)} – {hourLabel(result.endHour, locale)}
            </span>
          </p>
        </div>
        {best && <Badge variant="gradient" size="sm">{t("common.best")}</Badge>}
      </div>
      <p className="mt-4 text-caption text-muted">{t("experiment.avgReach")}</p>
      <p className="text-heading font-bold tabular-nums">{formatNumber(result.avgReach, locale)}</p>
      <div className="relative mt-2 h-1.5 rounded-pill bg-border" aria-hidden="true">
        <div
          className={cn("h-full rounded-pill", best ? "bg-ig-gradient" : "bg-muted")}
          style={{ width: `${(result.avgReach / maxReach) * 100}%` }}
        />
        <span className="absolute -top-1 h-3.5 w-px bg-foreground" style={{ insetInlineStart: `${(baseline / maxReach) * 100}%` }} />
      </div>
      <dl className="mt-3 flex items-center justify-between text-caption">
        <div>
          <dt className="text-muted">{t("experiment.vsBaseline")}</dt>
          <dd>
            <ChangeIndicator value={result.vsBaselinePct} />
          </dd>
        </div>
        <div className="text-end">
          <dt className="text-muted">{t("experiment.postsSampled")}</dt>
          <dd className="font-semibold tabular-nums">{result.postsSampled}</dd>
        </div>
      </dl>
    </div>
  );
}
