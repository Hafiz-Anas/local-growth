"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, ExternalLink, FileQuestion } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AiExplanation, AnalysisFootnote, DemoBadge, MeasuredBadge, PostThumb, SignedPct } from "@/components/analysis/shared";
import { ChipSelect } from "@/components/shared/chip-select";
import { EmptyState, ErrorState, Skeleton } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiClientError } from "@/lib/api/client";
import { qk, useMonitor } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { formatCompact, formatDateTime, formatNumber, intlLocale } from "@/lib/utils";
import type { MonitorDetailDto, MonitorSummaryText } from "@/types";
import { MonitorPostCard } from "./monitor-toggle";
import { MonitorStatusBadge, MonitorTiming } from "./shared";

type ChartMetric = "interactions" | "likes" | "comments" | "reach" | "saves" | "shares" | "views";
const CHART_METRICS: ChartMetric[] = ["interactions", "likes", "comments", "reach", "saves", "shares", "views"];

/** One monitored post: its numbers over the monitoring period, against the account's average, and the final summary. */
export function MonitorDetailView({ id }: { id: string }) {
  const { t } = useI18n();
  const query = useMonitor(id);

  return (
    <div>
      <Link href="/post-monitoring" className="mb-4 inline-flex items-center gap-1 text-body font-semibold text-muted hover:text-foreground">
        <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" />
        {t("monitoring.back")}
      </Link>
      {query.isPending ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-36 rounded-panel" />
          <Skeleton className="h-24 rounded-panel" />
          <Skeleton className="h-64 rounded-panel" />
        </div>
      ) : query.isError && !(query.error instanceof ApiClientError && query.error.status === 404) ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : !query.data ? (
        <EmptyState
          icon={FileQuestion}
          title={t("monitoring.goneTitle")}
          hint={t("monitoring.goneHint")}
          className="rounded-panel border border-border"
          action={
            <Button variant="secondary" asChild>
              <Link href="/post-monitoring">{t("monitoring.back")}</Link>
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

function Detail({ detail }: { detail: MonitorDetailDto }) {
  const { t, locale } = useI18n();
  const { post, latest, points } = detail;
  const first = points[0] ?? null;
  const posted = new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }).format(new Date(post.postedAt));
  const metrics = (["likes", "comments", "reach", "saves", "shares", "views"] as const).filter((m) => latest && latest[m] !== null);

  return (
    <div className="space-y-4">
      <Card className="flex gap-4 p-4">
        <PostThumb post={{ id: detail.igMediaId, caption: post.caption, mediaUrl: post.mediaUrl }} className="size-24 sm:size-32" />
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {detail.status !== "active" && <MonitorStatusBadge status={detail.status} />}
            <Badge variant="neutral" size="sm">
              {t(`analysis.format.${post.format}`)}
            </Badge>
            {detail.demo && <DemoBadge />}
          </div>
          <p className="text-caption text-muted">{t("monitoring.postedOn", { date: posted })}</p>
          <p className="mt-1 line-clamp-3 text-body whitespace-pre-line" dir="auto">
            {post.caption || t("postPerformance.noCaption")}
          </p>
          {detail.status !== "active" && <MonitorTiming item={detail} className="mt-1 text-caption text-muted" />}
          {post.permalink && (
            <a href={post.permalink} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-caption font-semibold text-primary">
              {t("postPerformance.openOnInstagram")}
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          )}
        </div>
      </Card>

      {detail.status === "active" && <MonitorPostCard igMediaId={detail.igMediaId} showLink={false} />}

      {detail.lastError && detail.status === "active" && (
        <p className="flex items-start gap-2 rounded-card bg-warning/10 p-3 text-body" role="status" data-testid="monitor-error">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          {t(`monitoring.errors.${detail.lastError}`)}
        </p>
      )}

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-title font-bold">{t("monitoring.latestTitle")}</h2>
          <MeasuredBadge />
        </div>
        {latest ? (
          <>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="monitor-metrics">
              {metrics.map((m) => {
                const value = latest[m]!;
                const before = first?.[m];
                const gained = points.length >= 2 && typeof before === "number" ? value - before : null;
                return (
                  <li key={m} className="rounded-card border border-border p-3" data-metric={m}>
                    <p className="text-caption text-muted">{t(`postPerformance.metric.${m}`)}</p>
                    <p className="text-title font-bold tabular-nums">{formatNumber(value, locale)}</p>
                    {gained !== null && <p className="mt-0.5 text-caption text-muted tabular-nums">{t("monitoring.sinceStart", { value: `${gained >= 0 ? "+" : "−"}${formatNumber(Math.abs(gained), locale)}` })}</p>}
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-caption text-muted">
              {t("monitoring.lastReading", { time: formatDateTime(latest.at, locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) })} · {t("monitoring.readings", { count: detail.readings })}
            </p>
            {detail.vsAveragePct !== null && detail.baseline.avgInteractions !== null && (
              <p className="mt-1 text-caption text-muted" data-testid="monitor-vs-average">
                <SignedPct value={detail.vsAveragePct} /> {t("monitoring.vsAverageOf", { avg: formatCompact(Math.round(detail.baseline.avgInteractions), locale), posts: detail.baseline.basedOn })}
              </p>
            )}
          </>
        ) : (
          <p className="text-body text-muted">{t("monitoring.noReadings")}</p>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="mb-1 text-title font-bold">{t("monitoring.chartTitle")}</h2>
        {points.length >= 2 ? (
          <MonitorChart detail={detail} />
        ) : (
          <p className="text-body text-muted" data-testid="monitor-chart-soon">
            {t(`monitoring.chartSoon.${detail.interval}`)}
          </p>
        )}
      </Card>

      {detail.outcome && <OutcomeCard detail={detail} />}

      {detail.outcome && (
        <AiExplanation<MonitorSummaryText>
          queryKey={qk.monitor(detail.id)}
          url={`/api/monitoring/${detail.id}/summary`}
          state={detail.summaryState}
          title={t("monitoring.summaryTitle")}
          render={(text) => (
            <p className="text-body" dir="auto">
              {locale === "ar" ? text.ar : text.en}
            </p>
          )}
        />
      )}
    </div>
  );
}

function OutcomeCard({ detail }: { detail: MonitorDetailDto }) {
  const { t, locale } = useI18n();
  const o = detail.outcome!;
  const time = (iso: string) => formatDateTime(iso, locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const gained = Object.entries(o.gained) as Array<[ChartMetric, number]>;
  return (
    <Card className="p-4" data-testid="monitor-outcome">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-title font-bold">{t("monitoring.outcomeTitle")}</h2>
        <MeasuredBadge />
      </div>
      <dl className="space-y-2 text-body">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">{t("monitoring.outcome.period")}</dt>
          <dd className="text-end tabular-nums">
            {time(o.startedAt)} – {time(o.endedAt)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">{t("monitoring.outcome.readings")}</dt>
          <dd className="tabular-nums">{formatNumber(o.readings, locale)}</dd>
        </div>
        {gained.length > 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{t("monitoring.outcome.gained")}</dt>
            <dd className="text-end tabular-nums">
              {gained.map(([m, v]) => `${t(`monitoring.metric.${m}`)} ${v >= 0 ? "+" : "−"}${formatNumber(Math.abs(v), locale)}`).join(" · ")}
            </dd>
          </div>
        )}
        {o.vsAverage.interactions && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{t("monitoring.outcome.vsAverage")}</dt>
            <dd className="text-end tabular-nums">
              <SignedPct value={o.vsAverage.interactions.pct} /> ({formatNumber(o.vsAverage.interactions.value, locale)} / {formatNumber(Math.round(o.vsAverage.interactions.average), locale)})
            </dd>
          </div>
        )}
        {o.peak && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{t("monitoring.outcome.peak")}</dt>
            <dd className="text-end tabular-nums">{t("monitoring.outcome.peakValue", { value: formatNumber(o.peak.gained, locale), from: time(o.peak.from), to: time(o.peak.to) })}</dd>
          </div>
        )}
      </dl>
      {o.baselinePosts > 0 && o.baselinePosts < 3 && <p className="mt-3 text-caption text-muted">{t("postPerformance.earlyComparison")}</p>}
    </Card>
  );
}

function MonitorChart({ detail }: { detail: MonitorDetailDto }) {
  const { t, locale, dir } = useI18n();
  const available = CHART_METRICS.filter((m) => m === "interactions" || detail.points.some((p) => p[m] !== null));
  const [metric, setMetric] = useState<ChartMetric>("interactions");
  const hourly = detail.interval === "hourly" && detail.points.length > 1 && Date.parse(detail.points.at(-1)!.at) - Date.parse(detail.points[0].at) <= 3 * 24 * 60 * 60 * 1000;
  const tick = (iso: string) => formatDateTime(iso, locale, hourly ? { hour: "numeric", minute: "2-digit" } : { day: "numeric", month: "short" });
  const full = (iso: string) => formatDateTime(iso, locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const average = metric === "interactions" ? detail.baseline.avgInteractions : metric === "reach" ? detail.baseline.avgReach : null;
  const data = detail.points.map((p) => ({ at: p.at, value: p[metric] as number | null }));

  return (
    <div>
      <p className="mb-3 text-caption text-muted">{t(`monitoring.chartHint.${detail.interval}`)}</p>
      {available.length > 1 && (
        <ChipSelect
          className="mb-3"
          options={available.map((m) => ({ value: m, label: t(`monitoring.metric.${m}`) }))}
          value={metric}
          onChange={setMetric}
          size="sm"
        />
      )}
      <div className="h-60 w-full" role="img" aria-label={t("monitoring.chartTitle")} data-testid="monitor-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--lge-chart-grid)" />
            <XAxis dataKey="at" reversed={dir === "rtl"} tickFormatter={tick} tick={{ fill: "var(--lge-text-secondary)", fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={28} />
            <YAxis orientation={dir === "rtl" ? "right" : "left"} tickFormatter={(v: number) => formatCompact(v, locale)} tick={{ fill: "var(--lge-text-secondary)", fontSize: 12 }} tickLine={false} axisLine={false} width={44} domain={["auto", "auto"]} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as { at: string; value: number | null };
                return (
                  <div className="rounded-button bg-elevated px-3 py-2 shadow-menu">
                    <p className="text-caption text-muted">{full(p.at)}</p>
                    <p className="text-body tabular-nums">
                      {t(`monitoring.metric.${metric}`)}: {p.value === null ? "–" : formatNumber(p.value, locale)}
                    </p>
                  </div>
                );
              }}
            />
            {average !== null && <ReferenceLine y={average} stroke="var(--lge-text-secondary)" strokeDasharray="4 3" ifOverflow="extendDomain" />}
            <Line type="monotone" dataKey="value" stroke="var(--lge-chart-line)" strokeWidth={2} dot={detail.points.length <= 30} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {average !== null && (
        <p className="mt-1 flex items-center gap-1.5 text-caption text-muted">
          <span className="w-4 border-t-2 border-dashed border-[var(--lge-text-secondary)]" aria-hidden="true" />
          {t("monitoring.averageLine", { value: formatCompact(Math.round(average), locale) })}
        </p>
      )}
    </div>
  );
}

