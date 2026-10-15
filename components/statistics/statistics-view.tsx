"use client";

import { useState, type ReactNode } from "react";
import { BarChart3, CalendarRange, Eye, Heart, Plug, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AiExplanation, AnalysisFootnote, DemoBadge, MeasuredBadge, SignedPct } from "@/components/analysis/shared";
import { ChipSelect } from "@/components/shared/chip-select";
import { PageHeader } from "@/components/shared/page-header";
import { StatTile } from "@/components/shared/stat-tile";
import { EmptyState, ErrorState, Skeleton } from "@/components/shared/states";
import { Card } from "@/components/ui/card";
import { STAT_RANGES, changePct, type StatRange } from "@/lib/analysis/statistics";
import { qk, useStatistics } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { formatCompact, formatNumber, intlLocale } from "@/lib/utils";
import type { StatisticsDto, StatisticsSummaryText, StatsPoint } from "@/types";

/** Insights → Statistics: account numbers over 7 days … 1 year, computed in code, with charts and a short AI summary. */
export function StatisticsView() {
  const { t } = useI18n();
  const [range, setRange] = useState<StatRange>("30d");
  const query = useStatistics(range);

  return (
    <div>
      <PageHeader title={t("statistics.title")} subtitle={t("statistics.subtitle")} actions={query.data?.demo && query.data.connected ? <DemoBadge /> : undefined} />
      <ChipSelect
        className="mb-4"
        options={STAT_RANGES.map((r) => ({ value: r, label: t(`statistics.range.${r}`) }))}
        value={range}
        onChange={setRange}
        size="sm"
      />
      {query.isPending ? (
        <StatsSkeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : !query.data.connected ? (
        <EmptyState icon={Plug} title={t("statistics.notConnected")} hint={t("statistics.notConnectedHint")} className="rounded-panel border border-border" />
      ) : (
        <Stats data={query.data} range={range} />
      )}
      <AnalysisFootnote />
    </div>
  );
}

function Stats({ data, range }: { data: StatisticsDto; range: StatRange }) {
  const { t, locale } = useI18n();
  const { current, previous } = data;
  const date = (d: string) => new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  const dataFrom = [data.availability.followersFrom, data.availability.postsFrom].filter((d): d is string => Boolean(d)).sort()[0];
  const vs = (now: number | null, before: number | null | undefined) => {
    const pct = changePct(now, before);
    return pct === null ? null : (
      <span className="text-caption font-normal text-muted">
        <SignedPct value={pct} /> {t("statistics.vsBefore")}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-card border border-border p-3 text-caption text-muted" data-testid="stat-availability">
        <CalendarRange className="mt-px size-4 shrink-0" aria-hidden="true" />
        <span>
          {dataFrom ? t("statistics.availableFrom", { date: date(dataFrom) }) : t("statistics.noDataYet")} {!data.availability.complete && dataFrom && t("statistics.partial")} {t("statistics.whyStored")}
          {data.sampleFollowers && data.availability.followersFrom && <> {t("statistics.sampleFollowers")}</>}
        </span>
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="stat-tiles">
        <Tile icon={Users} label={t("statistics.followers")} stat="followers" value={data.followers ? formatCompact(data.followers.end, locale) : "–"}>
          {data.followers && (
            <span className="text-caption font-normal text-muted">
              <SignedPct value={data.followers.change === 0 ? 0 : data.followers.changePct} /> ({data.followers.change >= 0 ? "+" : "−"}
              {formatNumber(Math.abs(data.followers.change), locale)})
            </span>
          )}
        </Tile>
        <Tile icon={BarChart3} label={t("statistics.postsPerWeek")} stat="postsPerWeek" value={formatNumber(current.postsPerWeek, locale)}>
          {vs(current.postsPerWeek, previous?.postsPerWeek)}
        </Tile>
        <Tile icon={Eye} label={t("statistics.avgReach")} stat="avgReach" value={current.avgReach !== null ? formatCompact(current.avgReach, locale) : "–"}>
          {vs(current.avgReach, previous?.avgReach)}
        </Tile>
        <Tile icon={Heart} label={t("statistics.engagement")} stat="engagement" value={current.engagementPct !== null ? `${formatNumber(current.engagementPct, locale)}%` : "–"}>
          {vs(current.engagementPct, previous?.engagementPct)}
        </Tile>
      </div>
      <p className="text-caption text-muted" data-testid="stat-posts-count">
        {t("statistics.postsInPeriod", { count: current.posts, interactions: formatNumber(current.interactions, locale) })}
      </p>

      <AiExplanation<StatisticsSummaryText>
        queryKey={qk.statistics(range)}
        url={`/api/statistics/summary?range=${range}`}
        state={data.summary}
        title={t("statistics.summaryTitle")}
        render={(text) => (
          <p className="text-body" dir="auto">
            {locale === "ar" ? text.ar : text.en}
          </p>
        )}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title={t("statistics.followersChart")} testId="chart-followers" ready={data.series.filter((p) => p.followers !== null).length >= 2} empty={t("statistics.followersSoon")}>
          <SeriesLine data={data} dataKey="followers" format={(v) => formatCompact(v, locale)} />
        </ChartCard>
        <ChartCard title={t("statistics.activityChart")} hint={t("statistics.activityHint")} testId="chart-activity" ready={current.posts > 0} empty={t("statistics.noPosts")}>
          <ActivityChart data={data} />
        </ChartCard>
        <ChartCard title={t("statistics.reachChart")} testId="chart-reach" ready={data.series.filter((p) => p.avgReach !== null).length >= 2} empty={t("statistics.reachSoon")}>
          <SeriesLine data={data} dataKey="avgReach" format={(v) => formatCompact(v, locale)} />
        </ChartCard>
        <ChartCard title={t("statistics.engagementChart")} hint={t("statistics.engagementHint")} testId="chart-engagement" ready={data.series.filter((p) => p.engagementPct !== null).length >= 2} empty={t("statistics.engagementSoon")}>
          <SeriesLine data={data} dataKey="engagementPct" format={(v) => `${formatNumber(v, locale)}%`} />
        </ChartCard>
      </div>

      {current.posts > 0 && (
        <div className="grid gap-4 lg:grid-cols-3">
          <BarsCard
            title={t("statistics.bestDays")}
            testId="best-days"
            rows={data.bestDays.map((d) => ({ key: d.key, label: t(`analysis.day.${d.key}`), value: d.avgInteractions, note: t("statistics.postsCount", { count: d.posts }) }))}
          />
          <BarsCard
            title={t("statistics.bestTimes")}
            testId="best-times"
            rows={data.bestTimes.map((d) => ({ key: d.key, label: t(`statistics.dayPart.${d.key}`), value: d.avgInteractions, note: t("statistics.postsCount", { count: d.posts }) }))}
          />
          <BarsCard
            title={t("statistics.contentMix")}
            testId="content-mix"
            percent
            rows={data.mix.map((m) => ({ key: m.format, label: t(`analysis.format.${m.format}`), value: m.sharePct, note: t("statistics.mixNote", { count: m.posts, avg: formatNumber(m.avgInteractions, locale) }) }))}
          />
        </div>
      )}
    </div>
  );
}

function Tile({ icon, label, value, stat, children }: { icon: typeof Users; label: string; value: string; stat: string; children?: ReactNode }) {
  return (
    <div data-stat={stat}>
      <StatTile
        icon={icon}
        label={label}
        value={
          <span className="flex flex-col">
            <span>{value}</span>
            {children}
          </span>
        }
        className="h-full"
      />
    </div>
  );
}

function ChartCard({ title, hint, testId, ready, empty, children }: { title: string; hint?: string; testId: string; ready: boolean; empty: string; children: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-title font-bold">{title}</h2>
        <MeasuredBadge />
      </div>
      {hint && <p className="mb-2 text-caption text-muted">{hint}</p>}
      {ready ? (
        <div className="h-52 w-full" role="img" aria-label={title} data-testid={testId}>
          {children}
        </div>
      ) : (
        <p className="py-6 text-body text-muted" data-testid={`${testId}-empty`}>
          {empty}
        </p>
      )}
    </Card>
  );
}

function useBucketLabel(data: StatisticsDto) {
  const { locale } = useI18n();
  const opts: Intl.DateTimeFormatOptions = data.bucket === "month" ? { month: "short", timeZone: "UTC" } : { day: "numeric", month: "short", timeZone: "UTC" };
  const fmt = new Intl.DateTimeFormat(intlLocale(locale), opts);
  return (d: string) => fmt.format(new Date(`${d}T00:00:00Z`));
}

const axis = { fill: "var(--lge-text-secondary)", fontSize: 12 };

function SeriesLine({ data, dataKey, format }: { data: StatisticsDto; dataKey: "followers" | "avgReach" | "engagementPct"; format: (v: number) => string }) {
  const { t, dir } = useI18n();
  const label = useBucketLabel(data);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data.series} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
        <CartesianGrid vertical={false} stroke="var(--lge-chart-grid)" />
        <XAxis dataKey="date" reversed={dir === "rtl"} tickFormatter={label} tick={axis} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis orientation={dir === "rtl" ? "right" : "left"} tickFormatter={format} tick={axis} tickLine={false} axisLine={false} width={48} domain={["auto", "auto"]} />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as StatsPoint;
            const v = p[dataKey];
            return (
              <div className="rounded-button bg-elevated px-3 py-2 shadow-menu">
                <p className="text-caption text-muted">{label(p.date)}</p>
                <p className="text-body tabular-nums">{v === null ? t("statistics.noValue") : format(v)}</p>
              </div>
            );
          }}
        />
        <Line type="linear" dataKey={dataKey} stroke="var(--lge-chart-line)" strokeWidth={2} dot={data.series.length <= 31 ? { r: 2 } : false} connectNulls isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function ActivityChart({ data }: { data: StatisticsDto }) {
  const { t, locale, dir } = useI18n();
  const label = useBucketLabel(data);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data.series} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
        <CartesianGrid vertical={false} stroke="var(--lge-chart-grid)" />
        <XAxis dataKey="date" reversed={dir === "rtl"} tickFormatter={label} tick={axis} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis orientation={dir === "rtl" ? "right" : "left"} tickFormatter={(v: number) => formatCompact(v, locale)} tick={axis} tickLine={false} axisLine={false} width={44} />
        <Tooltip
          cursor={{ fill: "var(--lge-chart-grid)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as StatsPoint;
            return (
              <div className="rounded-button bg-elevated px-3 py-2 shadow-menu">
                <p className="text-caption text-muted">{label(p.date)}</p>
                <p className="text-body tabular-nums">{t("postPerformance.interactionsValue", { value: formatNumber(p.interactions, locale) })}</p>
                <p className="text-body tabular-nums">{t("statistics.postsCount", { count: p.posts })}</p>
              </div>
            );
          }}
        />
        <Bar dataKey="interactions" fill="var(--lge-chart-line)" radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function BarsCard({ title, rows, testId, percent = false }: { title: string; rows: Array<{ key: string; label: string; value: number; note: string }>; testId: string; percent?: boolean }) {
  const { locale } = useI18n();
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card className="p-4">
      <h2 className="mb-3 text-title font-bold">{title}</h2>
      <ul className="space-y-2.5" data-testid={testId}>
        {rows.map((r, i) => (
          <li key={r.key} data-key={r.key}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-body">
              <span className={i === 0 && !percent ? "font-semibold" : undefined}>{r.label}</span>
              <span className="tabular-nums">{percent ? `${formatNumber(r.value, locale)}%` : formatNumber(r.value, locale)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-pill bg-button-secondary">
              <div className="h-full rounded-pill bg-[var(--lge-chart-line)]" style={{ width: `${(r.value / max) * 100}%` }} />
            </div>
            <p className="mt-0.5 text-caption text-muted">{r.note}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function StatsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-12 rounded-card" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-card" />
        ))}
      </div>
      <Skeleton className="h-28 rounded-panel" />
      <Skeleton className="h-64 rounded-panel" />
    </div>
  );
}
