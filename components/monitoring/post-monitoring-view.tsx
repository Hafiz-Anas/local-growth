"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, ChevronRight, Heart, MessageCircle, Plug, Plus } from "lucide-react";
import { AnalysisFootnote, DemoBadge, PostThumb, SignedPct } from "@/components/analysis/shared";
import { useActiveClient } from "@/components/providers/active-client-provider";
import { ChipSelect } from "@/components/shared/chip-select";
import { PageHeader, SectionTitle } from "@/components/shared/page-header";
import { EmptyState, ErrorState, Skeleton, SkeletonList } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MONITOR_DURATIONS, type MonitorDuration } from "@/lib/analysis/monitoring";
import { apiFetch } from "@/lib/api/client";
import { qk, useAction, useMonitoring } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { cn, formatCompact, intlLocale } from "@/lib/utils";
import { notify } from "@/store/ui-store";
import type { MonitorItemDto, MonitoringDto } from "@/types";
import { MiniChart, MonitorStatusBadge, MonitorTiming } from "./shared";

const HISTORY_SHOWN = 10;

/** Insights → Post monitoring: the posts being monitored (status, time left, a mini chart), and the history with each final summary. */
export function PostMonitoringView() {
  const { t } = useI18n();
  const query = useMonitoring();
  const [picking, setPicking] = useState(false);
  const [allHistory, setAllHistory] = useState(false);

  if (query.isPending) return <ListSkeleton />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const data = query.data;
  const canAdd = data.connected && data.active.length < data.limit && data.posts.some((p) => !data.active.some((m) => m.igMediaId === p.id));

  return (
    <div>
      <PageHeader
        title={t("monitoring.title")}
        subtitle={t("monitoring.subtitle")}
        actions={
          <div className="flex items-center gap-2">
            {data.demo && data.connected && <DemoBadge />}
            {canAdd && (
              <Button size="sm" onClick={() => setPicking(true)} data-testid="monitor-add">
                <Plus className="size-4" aria-hidden="true" />
                {t("monitoring.add")}
              </Button>
            )}
          </div>
        }
      />
      {!data.connected ? (
        <EmptyState icon={Plug} title={t("monitoring.notConnected")} hint={t("monitoring.notConnectedHint")} className="rounded-panel border border-border" />
      ) : (
        <>
          <p className="mb-3 text-caption text-muted" data-testid="monitor-limit">
            {t("monitoring.usage", { count: data.active.length, max: data.limit })}
          </p>
          {data.active.length ? (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-separator" data-testid="monitor-list">
                {data.active.map((m) => (
                  <MonitorRow key={m.id} item={m} />
                ))}
              </ul>
            </Card>
          ) : (
            <EmptyState
              icon={Activity}
              title={t("monitoring.emptyTitle")}
              hint={t("monitoring.emptyHint")}
              className="rounded-panel border border-border"
              action={
                canAdd ? (
                  <Button variant="secondary" onClick={() => setPicking(true)}>
                    {t("monitoring.add")}
                  </Button>
                ) : undefined
              }
            />
          )}

          <SectionTitle className="mt-8">{t("monitoring.history")}</SectionTitle>
          {data.history.length ? (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-separator" data-testid="monitor-history">
                {(allHistory ? data.history : data.history.slice(0, HISTORY_SHOWN)).map((m) => (
                  <HistoryRow key={m.id} item={m} />
                ))}
              </ul>
              {!allHistory && data.history.length > HISTORY_SHOWN && (
                <button type="button" onClick={() => setAllHistory(true)} className="block w-full border-t border-separator py-3 text-body font-semibold text-primary hover:bg-hover" data-testid="history-more">
                  {t("monitoring.historyMore", { count: data.history.length - HISTORY_SHOWN })}
                </button>
              )}
            </Card>
          ) : (
            <p className="text-body text-muted" data-testid="history-empty">
              {t("monitoring.historyEmpty")}
            </p>
          )}
        </>
      )}
      <AnalysisFootnote />
      {picking && <PickPostDialog data={data} onClose={() => setPicking(false)} />}
    </div>
  );
}

function Numbers({ item }: { item: MonitorItemDto }) {
  const { t, locale } = useI18n();
  if (!item.latest) return <span>{t("monitoring.noReadings")}</span>;
  return (
    <>
      <span className="flex items-center gap-0.5">
        <Heart className="size-3" aria-hidden="true" />
        {formatCompact(item.latest.likes, locale)}
      </span>
      <span className="flex items-center gap-0.5">
        <MessageCircle className="size-3 rtl:-scale-x-100" aria-hidden="true" />
        {formatCompact(item.latest.comments, locale)}
      </span>
      {item.latest.reach !== null && <span>{t("postPerformance.reachShort", { value: formatCompact(item.latest.reach, locale) })}</span>}
    </>
  );
}

function MonitorRow({ item }: { item: MonitorItemDto }) {
  const { t } = useI18n();
  return (
    <li>
      <Link href={`/post-monitoring/${item.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-hover" data-testid="monitor-row">
        <PostThumb post={{ id: item.igMediaId, caption: item.post.caption, mediaUrl: item.post.mediaUrl }} className="size-14" />
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center gap-2">
            <MonitorStatusBadge status={item.status} />
            {item.lastError && (
              <Badge variant="warning" size="sm">
                {t("monitoring.readingIssue")}
              </Badge>
            )}
          </div>
          <p className="truncate text-body" dir="auto">
            {item.post.caption || t("postPerformance.noCaption")}
          </p>
          <MonitorTiming item={item} className="text-caption text-muted" />
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-caption text-muted tabular-nums">
            <Numbers item={item} />
            {item.vsAveragePct !== null && (
              <span>
                <SignedPct value={item.vsAveragePct} /> {t("postPerformance.vsAvg")}
              </span>
            )}
          </p>
        </div>
        <MiniChart values={item.spark} className="w-16 sm:w-24" />
        <ChevronRight className="size-4 shrink-0 text-muted rtl:-scale-x-100" aria-hidden="true" />
      </Link>
    </li>
  );
}

function HistoryRow({ item }: { item: MonitorItemDto }) {
  const { t, locale } = useI18n();
  const summary = item.summary ? (locale === "ar" ? item.summary.ar : item.summary.en) : null;
  return (
    <li>
      <Link href={`/post-monitoring/${item.id}`} className="flex gap-3 px-4 py-3 hover:bg-hover" data-testid="history-row">
        <PostThumb post={{ id: item.igMediaId, caption: item.post.caption, mediaUrl: item.post.mediaUrl }} className="size-14" />
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex flex-wrap items-center gap-2">
            <MonitorStatusBadge status={item.status} />
            <MonitorTiming item={item} className="text-caption text-muted" />
          </div>
          <p className="truncate text-body" dir="auto">
            {item.post.caption || t("postPerformance.noCaption")}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-caption text-muted tabular-nums">
            <Numbers item={item} />
            <span>{t("monitoring.readings", { count: item.readings })}</span>
          </p>
          {summary ? (
            <p className="mt-1.5 line-clamp-3 text-body" dir="auto" data-testid="history-summary">
              {summary}
            </p>
          ) : (
            <p className="mt-1.5 text-caption text-muted" data-testid="history-numbers-only">
              {t("monitoring.numbersOnly")}
            </p>
          )}
        </div>
        <MiniChart values={item.spark} className="w-16 self-center sm:w-24" />
      </Link>
    </li>
  );
}

/** "Monitor a post": pick one of the recent posts, then how long. */
function PickPostDialog({ data, onClose }: { data: MonitoringDto; onClose: () => void }) {
  const { t, locale } = useI18n();
  const { isPreview } = useActiveClient();
  const queryClient = useQueryClient();
  const [postId, setPostId] = useState<string | null>(null);
  const [duration, setDuration] = useState<MonitorDuration>("24h");
  const start = useAction<MonitorItemDto, { igMediaId: string; duration: MonitorDuration }>({
    mutationFn: (body) => apiFetch("/api/monitoring", { method: "POST", body }),
    onSuccess: () => {
      notify.success(t("monitoring.started"));
      onClose();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.monitoring }),
  });
  const monitored = new Set(data.active.map((m) => m.igMediaId));
  const date = new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short" });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("monitoring.pickTitle")}</DialogTitle>
          <DialogDescription>{t("monitoring.pickHint")}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto p-4">
          <ul className="space-y-1" role="radiogroup" aria-label={t("monitoring.pickTitle")} data-testid="monitor-pick-posts">
            {data.posts.map((p) => {
              const taken = monitored.has(p.id);
              const selected = postId === p.id;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={taken}
                    onClick={() => setPostId(p.id)}
                    className={cn("flex w-full items-center gap-3 rounded-card p-2 text-start", selected ? "bg-primary-soft" : "hover:bg-hover", taken && "opacity-60")}
                  >
                    <PostThumb post={p} className="size-11" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body" dir="auto">
                        {p.caption || t("postPerformance.noCaption")}
                      </span>
                      <span className="text-caption text-muted">
                        {date.format(new Date(p.postedAt))} · {t(`analysis.format.${p.format}`)}
                      </span>
                    </span>
                    {taken && (
                      <Badge variant="success" size="sm">
                        {t("monitoring.status.active")}
                      </Badge>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <ChipSelect
            className="mt-4"
            label={t("monitoring.howLong")}
            hint={t("monitoring.intervalHint")}
            options={MONITOR_DURATIONS.map((d) => ({ value: d, label: t(`monitoring.duration.${d}`) }))}
            value={duration}
            onChange={setDuration}
            size="sm"
          />
          <div className="mt-4 flex gap-2">
            <Button disabled={!postId || start.isPending || isPreview} onClick={() => postId && start.mutate({ igMediaId: postId, duration })} data-testid="monitor-pick-start">
              {t("monitoring.start")}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ListSkeleton() {
  return (
    <div aria-busy="true">
      <Skeleton className="mb-2 h-7 w-48" />
      <Skeleton className="mb-6 h-4 w-72" />
      <SkeletonList rows={3} />
    </div>
  );
}
