"use client";

import Link from "next/link";
import { ChevronLeft, ExternalLink, FileQuestion, Megaphone } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MonitorPostCard } from "@/components/monitoring/monitor-toggle";
import { useFeature } from "@/components/providers/active-client-provider";
import { EmptyState, ErrorState, Skeleton } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiClientError } from "@/lib/api/client";
import { qk, usePostDetail } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { formatCompact, formatNumber, intlLocale } from "@/lib/utils";
import type { PostDetailDto, PostInsight } from "@/types";
import { ShareRateCard } from "./most-shared";
import { AiExplanation, AnalysisFootnote, DemoBadge, MeasuredBadge, PostThumb, SignedPct } from "./shared";

/** One post: its numbers vs the account's average, how they changed day by day, and the AI's short explanation. */
export function PostDetailView({ id }: { id: string }) {
  const { t } = useI18n();
  const query = usePostDetail(id);

  return (
    <div>
      <Link href="/post-performance" className="mb-4 inline-flex items-center gap-1 text-body font-semibold text-muted hover:text-foreground">
        <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" />
        {t("postPerformance.back")}
      </Link>
      {query.isPending ? (
        <DetailSkeleton />
      ) : query.isError && !(query.error instanceof ApiClientError && query.error.status === 404) ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : !query.data ? (
        <EmptyState
          icon={FileQuestion}
          title={t("postPerformance.goneTitle")}
          hint={t("postPerformance.goneHint")}
          className="rounded-panel border border-border"
          action={
            <Button variant="secondary" asChild>
              <Link href="/post-performance">{t("postPerformance.back")}</Link>
            </Button>
          }
        />
      ) : (
        <Detail detail={query.data} />
      )}
      <AnalysisFootnote />
    </div>
  );
}

function Detail({ detail }: { detail: PostDetailDto }) {
  const { t, locale } = useI18n();
  const monitoring = useFeature("monitoring");
  const { post } = detail;
  const date = new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }).format(new Date(post.postedAt));

  return (
    <div className="space-y-4">
      <Card className="flex gap-4 p-4">
        <PostThumb post={post} className="size-24 sm:size-32" />
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <Badge variant="neutral" size="sm">
              {t(`analysis.format.${post.format}`)}
            </Badge>
            {detail.method && (
              <Badge variant="outline" size="sm">
                {t(`analysis.method.${detail.method}`)}
              </Badge>
            )}
            {detail.promoted && (
              <Badge variant="warning" size="sm">
                <Megaphone />
                {t("methods.promoted")}
              </Badge>
            )}
            {detail.demo && <DemoBadge />}
          </div>
          <p className="text-caption text-muted">{date}</p>
          <p className="mt-1 line-clamp-4 text-body whitespace-pre-line" dir="auto">
            {post.caption || t("postPerformance.noCaption")}
          </p>
          {post.permalink && (
            <a href={post.permalink} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-caption font-semibold text-primary">
              {t("postPerformance.openOnInstagram")}
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          )}
        </div>
      </Card>

      {monitoring && <MonitorPostCard igMediaId={post.id} />}

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-title font-bold">{t("postPerformance.vsAverageTitle")}</h2>
          <MeasuredBadge />
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="post-metrics">
          {detail.vsAverage.map((m) => (
            <li key={m.metric} className="rounded-card border border-border p-3" data-metric={m.metric}>
              <p className="text-caption text-muted">{t(`postPerformance.metric.${m.metric}`)}</p>
              <p className="text-title font-bold tabular-nums">{formatNumber(m.value ?? 0, locale)}</p>
              {m.average !== null ? (
                <p className="mt-0.5 text-caption text-muted">
                  <SignedPct value={m.vsAveragePct} /> {t("postPerformance.vsAvgOf", { avg: formatCompact(Math.round(m.average), locale), posts: m.basedOn === 1 ? t("analysis.postsOne") : t("analysis.posts", { count: m.basedOn }) })}
                </p>
              ) : (
                <p className="mt-0.5 text-caption text-muted">{t("postPerformance.noAverage")}</p>
              )}
            </li>
          ))}
        </ul>
        {detail.comparedWith < 3 && <p className="mt-3 text-caption text-muted">{t("postPerformance.earlyComparison")}</p>}
      </Card>

      {detail.shareRate !== undefined && <ShareRateCard shareRate={detail.shareRate} />}

      <AiExplanation<PostInsight>
        queryKey={qk.postDetail(post.id)}
        url={`/api/post-performance/${encodeURIComponent(post.id)}/insight`}
        state={detail.insight}
        title={t("postPerformance.aiTitle")}
        render={(text) => {
          const side = locale === "ar" ? text.ar : text.en;
          return (
            <div className="space-y-2">
              <p className="text-body" dir="auto">
                {side.summary}
              </p>
              <p className="text-body" dir="auto">
                <span className="font-semibold">{t("postPerformance.learn")} </span>
                {side.learn}
              </p>
            </div>
          );
        }}
      />

      <Card className="p-4">
        <h2 className="mb-1 text-title font-bold">{t("postPerformance.historyTitle")}</h2>
        {detail.history.points.length >= 2 ? (
          <>
            <p className="mb-3 text-caption text-muted">{t("postPerformance.historyHint", { days: detail.history.points.length })}</p>
            <HistoryChart detail={detail} />
          </>
        ) : (
          <p className="text-body text-muted" data-testid="history-soon">
            {t("postPerformance.historySoon")}
          </p>
        )}
      </Card>
    </div>
  );
}

function HistoryChart({ detail }: { detail: PostDetailDto }) {
  const { t, locale, dir } = useI18n();
  const fmt = new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", timeZone: "UTC" });
  const date = (iso: string) => fmt.format(new Date(`${iso}T00:00:00Z`));
  const hasReach = detail.history.points.some((p) => p.reach !== null);
  return (
    <div className="h-52 w-full" role="img" aria-label={t("postPerformance.historyTitle")} data-testid="history-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={detail.history.points} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--lge-chart-grid)" />
          <XAxis dataKey="date" reversed={dir === "rtl"} tickFormatter={date} tick={{ fill: "var(--lge-text-secondary)", fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis yAxisId="i" orientation={dir === "rtl" ? "right" : "left"} tickFormatter={(v: number) => formatCompact(v, locale)} tick={{ fill: "var(--lge-text-secondary)", fontSize: 12 }} tickLine={false} axisLine={false} width={40} />
          {hasReach && <YAxis yAxisId="r" orientation={dir === "rtl" ? "left" : "right"} tickFormatter={(v: number) => formatCompact(v, locale)} tick={{ fill: "var(--lge-text-secondary)", fontSize: 12 }} tickLine={false} axisLine={false} width={44} />}
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as PostDetailDto["history"]["points"][number];
              return (
                <div className="rounded-button bg-elevated px-3 py-2 shadow-menu">
                  <p className="text-caption text-muted">{date(p.date)}</p>
                  <p className="text-body tabular-nums">{t("postPerformance.interactionsValue", { value: formatNumber(p.interactions, locale) })}</p>
                  {p.reach !== null && <p className="text-body tabular-nums">{t("postPerformance.reachShort", { value: formatNumber(p.reach, locale) })}</p>}
                </div>
              );
            }}
          />
          <Line yAxisId="i" type="monotone" dataKey="interactions" name={t("postPerformance.interactions")} stroke="var(--lge-chart-line)" strokeWidth={2} dot={false} isAnimationActive={false} />
          {hasReach && <Line yAxisId="r" type="monotone" dataKey="reach" name={t("postPerformance.metric.reach")} stroke="var(--lge-chart-alt)" strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />}
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-1 flex flex-wrap gap-x-4 text-caption text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-[var(--lge-chart-line)]" aria-hidden="true" />
          {t("postPerformance.interactions")}
        </span>
        {hasReach && (
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 border-t-2 border-dashed border-[var(--lge-chart-alt)]" aria-hidden="true" />
            {t("postPerformance.metric.reach")}
          </span>
        )}
      </p>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-36 rounded-panel" />
      <Skeleton className="h-48 rounded-panel" />
      <Skeleton className="h-56 rounded-panel" />
    </div>
  );
}
