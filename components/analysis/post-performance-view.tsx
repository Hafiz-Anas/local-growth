"use client";

import Link from "next/link";
import { BarChart3, ChevronRight, Eye, Heart, MessageCircle, Plug, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/shared/page-header";
import { StatTile } from "@/components/shared/stat-tile";
import { EmptyState, ErrorState, Skeleton, SkeletonList } from "@/components/shared/states";
import { Card } from "@/components/ui/card";
import { usePostPerformance } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { formatCompact, formatNumber, intlLocale } from "@/lib/utils";
import type { PostPerformanceDto } from "@/types";
import { AnalysisFootnote, DemoBadge, MeasuredBadge, PostThumb, SignedPct } from "./shared";

/** Insights → Post performance: the last posts compared with each other, with a chart; each opens its detail. */
export function PostPerformanceView() {
  const { t, locale } = useI18n();
  const query = usePostPerformance();

  if (query.isPending) return <ListSkeleton />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const { summary, media, demo, connected } = query.data;

  return (
    <div>
      <PageHeader title={t("postPerformance.title")} subtitle={t("postPerformance.subtitle")} actions={demo && connected ? <DemoBadge /> : undefined} />
      {!summary.posts.length ? (
        <EmptyState icon={connected ? BarChart3 : Plug} title={t(connected ? "postPerformance.emptyTitle" : "postPerformance.notConnected")} hint={t("postPerformance.emptyHint")} className="rounded-panel border border-border" />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatTile icon={Heart} label={t("postPerformance.avgInteractions")} value={formatCompact(Math.round(summary.avgInteractions), locale)} />
            <StatTile icon={Eye} label={t("postPerformance.avgReach")} value={summary.avgReach !== null ? formatCompact(summary.avgReach, locale) : "–"} />
            <StatTile
              icon={TrendingUp}
              label={t("postPerformance.trend")}
              value={<SignedPct value={summary.trendPct} />}
              className="col-span-2 lg:col-span-1"
            />
          </div>

          <Card className="mb-4 p-4">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-title font-bold">{t("postPerformance.chartTitle", { count: summary.posts.length })}</h2>
              <MeasuredBadge />
            </div>
            <p className="mb-3 text-caption text-muted">{t("postPerformance.chartHint")}</p>
            <RecentChart data={query.data} />
          </Card>

          <Card className="overflow-hidden">
            <ul className="divide-y divide-separator" data-testid="recent-posts">
              {summary.posts.map((p) => (
                <li key={p.id}>
                  <Link href={`/post-performance/${encodeURIComponent(p.id)}`} className="flex items-center gap-3 px-4 py-3 hover:bg-hover" data-testid="recent-post">
                    <PostThumb post={{ id: p.id, caption: p.caption, mediaUrl: media[p.id]?.mediaUrl ?? null }} className="size-14" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body" dir="auto">
                        {p.caption || t("postPerformance.noCaption")}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-caption text-muted tabular-nums">
                        <span>{new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short" }).format(new Date(p.postedAt))}</span>
                        <span>{t(`analysis.format.${p.format}`)}</span>
                        <span className="flex items-center gap-0.5">
                          <Heart className="size-3" aria-hidden="true" />
                          {formatCompact(p.likes, locale)}
                        </span>
                        <span className="flex items-center gap-0.5">
                          <MessageCircle className="size-3 rtl:-scale-x-100" aria-hidden="true" />
                          {formatCompact(p.comments, locale)}
                        </span>
                        {p.reach !== null && <span>{t("postPerformance.reachShort", { value: formatCompact(p.reach, locale) })}</span>}
                      </p>
                    </div>
                    <div className="shrink-0 text-end">
                      <SignedPct value={p.vsAveragePct} className="text-body" />
                      <p className="text-caption text-muted">{t("postPerformance.vsAvg")}</p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted rtl:-scale-x-100" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
      <AnalysisFootnote />
    </div>
  );
}

function RecentChart({ data }: { data: PostPerformanceDto }) {
  const { t, locale, dir } = useI18n();
  const fmt = new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short" });
  // Oldest on the left (reading order), newest on the right.
  const rows = [...data.summary.posts].reverse().map((p) => ({ id: p.id, label: fmt.format(new Date(p.postedAt)), interactions: p.interactions, best: p.id === data.summary.best }));
  return (
    <div className="h-52 w-full" role="img" aria-label={t("postPerformance.chartTitle", { count: rows.length })} data-testid="recent-chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--lge-chart-grid)" />
          <XAxis dataKey="label" reversed={dir === "rtl"} tick={{ fill: "var(--lge-text-secondary)", fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={8} />
          <YAxis orientation={dir === "rtl" ? "right" : "left"} tickFormatter={(v: number) => formatCompact(v, locale)} tick={{ fill: "var(--lge-text-secondary)", fontSize: 12 }} tickLine={false} axisLine={false} width={40} />
          <ReferenceLine y={data.summary.avgInteractions} stroke="var(--lge-chart-alt)" strokeDasharray="4 4" />
          <Tooltip
            cursor={{ fill: "var(--lge-chart-grid)" }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <div className="rounded-button bg-elevated px-3 py-2 shadow-menu">
                  <p className="text-caption text-muted">{payload[0].payload.label}</p>
                  <p className="text-body font-bold tabular-nums">{t("postPerformance.interactionsValue", { value: formatNumber(payload[0].payload.interactions, locale) })}</p>
                </div>
              ) : null
            }
          />
          <Bar dataKey="interactions" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.id} fill={r.best ? "var(--lge-chart-line)" : "var(--lge-chart-alt)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-1 text-caption text-muted">{t("postPerformance.avgLine", { value: formatNumber(Math.round(data.summary.avgInteractions), locale) })}</p>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div aria-busy="true">
      <div className="mb-6 space-y-2.5">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[66px] rounded-card" />
        ))}
      </div>
      <Skeleton className="mb-4 h-64 rounded-panel" />
      <div className="rounded-panel border border-border">
        <SkeletonList rows={4} />
      </div>
    </div>
  );
}
