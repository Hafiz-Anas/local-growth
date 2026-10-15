"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Heart, MessageCircle, Plus, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Avatar } from "@/components/shared/avatar";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, Skeleton } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { qk, useCompetitorAnalysis } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { cn, formatCompact, formatNumber, initials, intlLocale, toneFor } from "@/lib/utils";
import type { AccountStats, CompetitorAnalysisDto, CompetitorAnalysisItemDto, CompetitorInsight, MetricComparison } from "@/types";
import { AiExplanation, AnalysisFootnote, DemoBadge, MeasuredBadge, PointList, PostThumb } from "./shared";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const FORMATS = ["reel", "carousel", "photo", "video"] as const;

/** Competitors → Analysis: the business vs each tracked competitor (measured), growth over time and the AI's comparison. */
export function CompetitorAnalysisView() {
  const { t } = useI18n();
  const query = useCompetitorAnalysis();
  const [selected, setSelected] = useState<string | null>(null);

  if (query.isPending) return <AnalysisSkeleton />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const data = query.data;
  const current = data.competitors.find((c) => c.id === selected) ?? data.competitors[0];

  return (
    <div>
      <PageHeader
        title={t("competitorAnalysis.title")}
        subtitle={t("competitorAnalysis.subtitle")}
        actions={data.you.demo && data.you.connected ? <DemoBadge /> : undefined}
      />
      <p className="mb-4 text-caption text-muted" data-testid="competitor-limit">
        {t("competitorAnalysis.tracking", { count: data.tracked, max: data.limit })}
      </p>

      {!data.competitors.length ? (
        <EmptyState
          icon={Users}
          title={t("competitorAnalysis.emptyTitle")}
          hint={t("competitorAnalysis.emptyHint")}
          className="rounded-panel border border-border"
          action={
            <Button asChild>
              <Link href="/competitors">
                <Plus className="size-4" />
                {t("competitorAnalysis.add")}
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="-mx-4 mb-5 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0" role="tablist" aria-label={t("competitorAnalysis.pick")}>
            <div className="flex min-w-max gap-2">
              {data.competitors.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={c.id === current.id}
                  onClick={() => setSelected(c.id)}
                  className={cn(
                    "flex h-10 items-center gap-2 rounded-pill border px-3 text-body font-semibold transition-colors",
                    c.id === current.id ? "border-foreground bg-foreground text-background" : "border-border hover:bg-hover",
                  )}
                  data-testid="competitor-chip"
                >
                  <Avatar src={c.avatarUrl} initials={initials(c.name)} tone={toneFor(c.handle)} size="xs" />
                  <bdi>@{c.handle}</bdi>
                  {c.issue && <AlertTriangle className="size-3.5 text-warning" aria-hidden="true" />}
                </button>
              ))}
            </div>
          </div>
          <CompetitorPanel key={current.id} data={data} item={current} />
        </>
      )}
      <AnalysisFootnote />
    </div>
  );
}

function CompetitorPanel({ data, item }: { data: CompetitorAnalysisDto; item: CompetitorAnalysisItemDto }) {
  const { t, locale } = useI18n();
  return (
    <div className="space-y-4" data-testid="competitor-panel">
      {item.issue && (
        <p className="flex items-start gap-2 rounded-card bg-warning/15 p-3 text-body text-warning" role="status" data-testid="competitor-issue">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t(`competitorAnalysis.issue.${item.issue}`)}
        </p>
      )}

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-title font-bold">{t("competitorAnalysis.vs", { handle: item.handle })}</h2>
          <MeasuredBadge />
        </div>
        {!item.stats ? (
          <p className="text-body text-muted">{t("competitorAnalysis.noPosts")}</p>
        ) : (
          <ComparisonTable you={data.you.stats} them={item.stats} comparison={item.comparison} youFollowers={data.you.followers} themFollowers={item.followers} handle={item.handle} />
        )}
        {item.dataAt && (
          <p className="mt-3 text-caption text-muted">
            {t("competitorAnalysis.dataAt", { date: new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short" }).format(new Date(item.dataAt)) })}
          </p>
        )}
      </Card>

      <AiExplanation<CompetitorInsight>
        queryKey={[...qk.competitorAnalysis, item.id]}
        url={`/api/competitors/${item.id}/insight`}
        state={item.insight}
        title={t("competitorAnalysis.aiTitle")}
        render={(text) => {
          const side = locale === "ar" ? text.ar : text.en;
          return (
            <div className="space-y-3">
              <p className="text-body" dir="auto">
                {side.tactics}
              </p>
              <AiGroup title={t("competitorAnalysis.theyBetter")} items={side.theyBetter} />
              <AiGroup title={t("competitorAnalysis.youBetter")} items={side.youBetter} />
              <AiGroup title={t("competitorAnalysis.ideas")} items={side.ideas} />
            </div>
          );
        }}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-1 text-title font-bold">{t("competitorAnalysis.growth")}</h2>
          {item.growth.points.length >= 2 ? (
            <>
              <p className="mb-2 text-caption text-muted">
                {t("competitorAnalysis.growthChange", { pct: formatNumber(item.growth.changePct ?? 0, locale), weeks: item.growth.weeks })}
              </p>
              <GrowthChart points={item.growth.points} />
            </>
          ) : (
            <p className="text-body text-muted">{t("competitorAnalysis.growthSoon")}</p>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-title font-bold">{t("competitorAnalysis.mix")}</h2>
          <MixBars you={data.you.stats} them={item.stats} handle={item.handle} />
        </Card>

        <Card className="p-4">
          <h2 className="mb-1 text-title font-bold">{t("competitorAnalysis.days")}</h2>
          {item.stats && (
            <p className="mb-2 text-caption text-muted">
              {t("competitorAnalysis.usual", {
                day: item.stats.usualDay ? t(`analysis.day.${item.stats.usualDay}`) : "–",
                time: item.stats.usualTime ? t(`analysis.part.${item.stats.usualTime}`) : "–",
              })}
            </p>
          )}
          <DaysChart you={data.you.stats} them={item.stats} handle={item.handle} />
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-title font-bold">{t("competitorAnalysis.hashtags")}</h2>
          {item.stats?.hashtags.length ? (
            <>
              <ul className="flex flex-wrap gap-1.5">
                {item.stats.hashtags.map((h) => (
                  <li key={h.tag}>
                    <Badge variant="outline">
                      <bdi>{h.tag}</bdi> · {formatNumber(h.count, locale)}
                    </Badge>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-caption text-muted">{t("competitorAnalysis.hashtagsPerPost", { count: formatNumber(item.stats.hashtagsPerPost, locale) })}</p>
            </>
          ) : (
            <p className="text-body text-muted">{t("competitorAnalysis.noHashtags")}</p>
          )}
          {item.methods.length > 0 && (
            <>
              <h3 className="mt-4 mb-2 flex items-center gap-2 text-body font-semibold">
                {t("competitorAnalysis.contentTypes")}
                <Badge variant="neutral" size="sm">
                  {t("analysis.estimated")}
                </Badge>
              </h3>
              <ul className="flex flex-wrap gap-1.5">
                {item.methods.map((m) => (
                  <li key={m.method}>
                    <Badge variant="neutral">
                      {t(`analysis.method.${m.method}`)} · {formatNumber(m.posts, locale)}
                    </Badge>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      {item.bestPosts.length > 0 && (
        <Card className="p-4">
          <h2 className="mb-3 text-title font-bold">{t("competitorAnalysis.bestPosts")}</h2>
          <ul className="grid grid-cols-3 gap-2 sm:gap-3">
            {item.bestPosts.map((p) => (
              <li key={p.id} className="min-w-0">
                <a href={p.permalink ?? undefined} target="_blank" rel="noreferrer" className={cn("block", !p.permalink && "pointer-events-none")}>
                  <PostThumb post={p} className="aspect-square w-full" />
                </a>
                <p className="mt-1.5 flex flex-wrap gap-x-2 text-caption text-muted tabular-nums">
                  <span className="flex items-center gap-0.5">
                    <Heart className="size-3" aria-hidden="true" />
                    {formatCompact(p.likes, locale)}
                  </span>
                  <span className="flex items-center gap-0.5">
                    <MessageCircle className="size-3 rtl:-scale-x-100" aria-hidden="true" />
                    {formatCompact(p.comments, locale)}
                  </span>
                </p>
                <p className="text-caption text-muted">{t(`analysis.format.${p.format}`)}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function AiGroup({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className="mb-1 text-body font-semibold">{title}</h3>
      <PointList items={items} />
    </div>
  );
}

const METRIC_FORMAT: Record<MetricComparison["metric"], (n: number, locale: "en" | "ar") => string> = {
  postsPerWeek: (n, l) => formatNumber(n, l),
  engagementPct: (n, l) => `${formatNumber(n, l)}%`,
  avgInteractions: (n, l) => formatCompact(Math.round(n), l),
  reelShare: (n, l) => `${formatNumber(n, l)}%`,
  hashtagsPerPost: (n, l) => formatNumber(n, l),
};

function ComparisonTable({
  you,
  them,
  comparison,
  youFollowers,
  themFollowers,
  handle,
}: {
  you: AccountStats | null;
  them: AccountStats;
  comparison: MetricComparison[];
  youFollowers: number | null;
  themFollowers: number;
  handle: string;
}) {
  const { t, locale } = useI18n();
  const cell = "py-2 ps-3 text-end whitespace-nowrap tabular-nums";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[300px] text-body" data-testid="comparison-table">
        <thead>
          <tr className="text-caption text-muted">
            <th className="py-1.5 text-start font-normal">{t("competitorAnalysis.metric")}</th>
            <th className="py-1.5 ps-3 text-end font-normal">{t("competitorAnalysis.you")}</th>
            <th className="max-w-28 truncate py-1.5 ps-3 text-end font-normal">
              <bdi>@{handle}</bdi>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-separator">
          <tr>
            <td className="py-2">{t("competitorAnalysis.metrics.followers")}</td>
            <td className={cell}>{youFollowers !== null ? formatCompact(youFollowers, locale) : "–"}</td>
            <td className={cell}>{formatCompact(themFollowers, locale)}</td>
          </tr>
          {comparison.map((c) => (
            <tr key={c.metric} data-metric={c.metric}>
              <td className="py-2 pe-3">
                {t(`competitorAnalysis.metrics.${c.metric}`)}
                {c.ahead && c.ahead !== "same" && <span className="sr-only"> — {c.ahead === "you" ? t("competitorAnalysis.youAhead") : t("competitorAnalysis.theyAhead")}</span>}
              </td>
              <td className={cn(cell, c.ahead === "you" && "font-bold text-success")}>{c.you !== null ? METRIC_FORMAT[c.metric](c.you, locale) : "–"}</td>
              <td className={cn(cell, c.ahead === "them" && "font-bold")}>{c.them !== null ? METRIC_FORMAT[c.metric](c.them, locale) : "–"}</td>
            </tr>
          ))}
          <tr>
            <td className="py-2">{t("competitorAnalysis.metrics.posts")}</td>
            <td className={cell}>{you ? formatNumber(you.posts, locale) : "–"}</td>
            <td className={cell}>{formatNumber(them.posts, locale)}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-caption text-muted">{t("competitorAnalysis.aheadLegend")}</p>
    </div>
  );
}

function ChartTip({ label, rows }: { label: string; rows: Array<{ name: string; value: string }> }) {
  return (
    <div className="rounded-button bg-elevated px-3 py-2 shadow-menu">
      <p className="text-caption text-muted">{label}</p>
      {rows.map((r) => (
        <p key={r.name} className="text-body tabular-nums">
          <span className="text-muted">{r.name}: </span>
          <span className="font-bold">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

function GrowthChart({ points }: { points: CompetitorAnalysisItemDto["growth"]["points"] }) {
  const { t, locale, dir } = useI18n();
  const fmt = new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", timeZone: "UTC" });
  const date = (iso: string) => fmt.format(new Date(`${iso}T00:00:00Z`));
  return (
    <div className="h-44 w-full" role="img" aria-label={t("competitorAnalysis.growth")} data-testid="growth-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--lge-chart-grid)" />
          <XAxis dataKey="date" reversed={dir === "rtl"} tickFormatter={date} tick={{ fill: "var(--lge-text-secondary)", fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={28} />
          <YAxis orientation={dir === "rtl" ? "right" : "left"} tickFormatter={(v: number) => formatCompact(v, locale)} tick={{ fill: "var(--lge-text-secondary)", fontSize: 12 }} tickLine={false} axisLine={false} width={44} domain={["auto", "auto"]} />
          <Tooltip
            content={({ active, payload }) =>
              active && payload?.length ? (
                <ChartTip label={date(payload[0].payload.date)} rows={[{ name: t("competitorAnalysis.metrics.followers"), value: formatNumber(payload[0].payload.followers, locale) }]} />
              ) : null
            }
          />
          <Line type="monotone" dataKey="followers" stroke="var(--lge-chart-line)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function MixBars({ you, them, handle }: { you: AccountStats | null; them: AccountStats | null; handle: string }) {
  const { t, locale } = useI18n();
  const share = (s: AccountStats | null, f: (typeof FORMATS)[number]) => s?.mix.find((m) => m.format === f)?.sharePct ?? 0;
  const rows = FORMATS.filter((f) => share(you, f) || share(them, f));
  if (!rows.length) return <p className="text-body text-muted">{t("competitorAnalysis.noPosts")}</p>;
  return (
    <ul className="space-y-3" data-testid="mix-bars">
      {rows.map((f) => (
        <li key={f}>
          <p className="mb-1 text-caption font-semibold">{t(`analysis.format.${f}`)}</p>
          {[
            { who: t("competitorAnalysis.you"), pct: share(you, f), color: "var(--lge-chart-line)" },
            { who: `@${handle}`, pct: share(them, f), color: "var(--lge-chart-alt)" },
          ].map((row) => (
            <div key={row.who} className="flex items-center gap-2 text-caption">
              <span className="w-24 shrink-0 truncate text-muted">
                <bdi>{row.who}</bdi>
              </span>
              <span className="h-2 flex-1 overflow-hidden rounded-pill bg-button-secondary">
                <span className="block h-full rounded-pill" style={{ width: `${row.pct}%`, background: row.color }} />
              </span>
              <span className="w-10 shrink-0 text-end tabular-nums">{formatNumber(row.pct, locale)}%</span>
            </div>
          ))}
        </li>
      ))}
    </ul>
  );
}

function DaysChart({ you, them, handle }: { you: AccountStats | null; them: AccountStats | null; handle: string }) {
  const { t, locale, dir } = useI18n();
  const count = (s: AccountStats | null, d: (typeof WEEKDAYS)[number]) => s?.byWeekday.find((w) => w.key === d)?.posts ?? 0;
  const rows = WEEKDAYS.map((d) => ({ day: t(`analysis.dayShort.${d}`), you: count(you, d), them: count(them, d) }));
  const youLabel = t("competitorAnalysis.you");
  const themLabel = `@${handle}`;
  return (
    <div className="h-44 w-full" role="img" aria-label={t("competitorAnalysis.days")} data-testid="days-chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--lge-chart-grid)" />
          <XAxis dataKey="day" reversed={dir === "rtl"} tick={{ fill: "var(--lge-text-secondary)", fontSize: 11 }} tickLine={false} axisLine={false} interval={0} />
          <YAxis orientation={dir === "rtl" ? "right" : "left"} allowDecimals={false} tick={{ fill: "var(--lge-text-secondary)", fontSize: 12 }} tickLine={false} axisLine={false} width={28} />
          <Tooltip
            cursor={{ fill: "var(--lge-chart-grid)" }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <ChartTip
                  label={String(label)}
                  rows={[
                    { name: youLabel, value: formatNumber(payload[0].payload.you, locale) },
                    { name: themLabel, value: formatNumber(payload[0].payload.them, locale) },
                  ]}
                />
              ) : null
            }
          />
          <Legend formatter={(value: string) => <span className="text-caption text-muted">{value === "you" ? youLabel : themLabel}</span>} iconSize={8} />
          <Bar dataKey="you" fill="var(--lge-chart-line)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="them" fill="var(--lge-chart-alt)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function AnalysisSkeleton() {
  return (
    <div aria-busy="true">
      <div className="mb-6 space-y-2.5">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="mb-5 flex gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-32 rounded-pill" />
        ))}
      </div>
      <Skeleton className="mb-4 h-64 rounded-panel" />
      <Skeleton className="h-40 rounded-panel" />
    </div>
  );
}
