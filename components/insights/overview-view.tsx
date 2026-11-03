"use client";

import Link from "next/link";
import { ChevronRight, Plug } from "lucide-react";
import { TipCard } from "@/components/recommendations/recommendations-view";
import { DemoBadge, SignedPct } from "@/components/analysis/shared";
import { useActiveClient, useFeature } from "@/components/providers/active-client-provider";
import { PageHeader, SectionTitle } from "@/components/shared/page-header";
import { ErrorState, Skeleton, SkeletonList } from "@/components/shared/states";
import { useInsightsOverview, useRecommendations } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { cn, formatNumber, intlLocale } from "@/lib/utils";
import { BEST_FORMAT_DAYS, type OverviewMetric, type OverviewSummary } from "@/lib/analysis/overview";
import type { InsightsOverviewDto } from "@/types";

/**
 * Insights → Overview (UX3), the section's first tab: three key numbers for the last 7 days vs the
 * 7 before (picked for the business's goal), this week's tips from Recommendations (Mark as done /
 * Not for me work here too) and a one-or-two-sentence summary — everything computed in code from
 * real data, each with what it rests on, and "Not enough data yet" instead of a guess. Each part links
 * to the tab with the details.
 */
export function InsightsOverviewView() {
  const { t } = useI18n();
  const query = useInsightsOverview();
  const showTips = useFeature("recommendations");
  const reports = useFeature("reports");

  if (query.isPending) return <OverviewSkeleton />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const data = query.data;
  // Followers and the summary have their week in Weekly reports; the post numbers are on Post performance.
  const summaryHref = reports ? "/reports" : "/post-performance";

  return (
    <div data-testid="insights-overview">
      <PageHeader title={t("insightsOverview.title")} subtitle={t("insightsOverview.subtitle")} actions={data.demo && data.connected ? <DemoBadge /> : undefined} />

      {!data.connected && (
        <div className="mb-6 flex items-start gap-3 rounded-card border border-border bg-secondary-bg p-4" role="status" data-testid="overview-not-connected">
          <Plug className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-body font-semibold">{t("insightsOverview.notConnectedTitle")}</p>
            <p className="mt-0.5 text-caption text-muted">{t("insightsOverview.notConnectedHint")}</p>
            <Link href="/settings" className="mt-1.5 inline-flex items-center gap-0.5 text-body font-semibold text-primary hover:underline">
              {t("insightsOverview.openSettings")}
              <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
            </Link>
          </div>
        </div>
      )}

      <div className="space-y-8">
        <KeyNumbers data={data} followersHref={reports ? "/reports" : "/post-performance"} />
        {showTips && <NextActions />}
        <Summary summary={data.connected ? data.summary : null} href={summaryHref} />
      </div>
    </div>
  );
}

function usePeriod(data: InsightsOverviewDto) {
  const { locale } = useI18n();
  const fmt = new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short" });
  // The last day shown is the day before each period's end (the end itself is "now" / the start of the next).
  const range = (from: string, to: string) => fmt.formatRange(new Date(from), new Date(Date.parse(to) - 1));
  return { current: range(data.period.start, data.period.end), previous: range(data.period.previousStart, data.period.start) };
}

function KeyNumbers({ data, followersHref }: { data: InsightsOverviewDto; followersHref: string }) {
  const { t } = useI18n();
  const period = usePeriod(data);
  return (
    <section aria-labelledby="overview-numbers">
      <SectionTitle className="mb-1">
        <span id="overview-numbers">{t("insightsOverview.numbersTitle")}</span>
      </SectionTitle>
      <p className="mb-3 flex flex-wrap gap-x-3 text-caption text-muted">
        <span data-testid="overview-period">{t("insightsOverview.period", { current: period.current, previous: period.previous })}</span>
        {data.goal && <span data-testid="overview-goal">{t("insightsOverview.goal", { goal: t(`insightsOverview.goals.${data.goal}`) })}</span>}
      </p>
      <ul className="grid gap-3 sm:grid-cols-3">
        {data.metrics.map((m) => (
          <MetricCard key={m.key} metric={m} href={m.key === "newFollowers" ? followersHref : "/post-performance"} />
        ))}
      </ul>
    </section>
  );
}

function MetricCard({ metric: m, href }: { metric: OverviewMetric; href: string }) {
  const { t, locale } = useI18n();
  const name = t(`insightsOverview.metrics.${m.key}`);
  const value = (n: number) => (m.key === "newFollowers" ? `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatNumber(Math.abs(n), locale)}` : new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 1 }).format(n));
  const basedOn = m.key === "newFollowers" ? t("insightsOverview.fromDailyCounts") : t("insightsOverview.basedOn", { count: formatNumber(m.posts.current, locale) });

  return (
    <li className="flex flex-col rounded-card border border-border bg-background p-4" data-testid="overview-metric" data-metric={m.key} data-state={m.state}>
      <p className="text-caption font-semibold text-muted">{name}</p>
      {m.state === "not_enough" ? (
        <>
          <p className="mt-1 text-title font-bold" data-testid="metric-not-enough">
            {t("insightsOverview.notEnough")}
          </p>
          <p className="mt-0.5 text-caption text-muted">{t(m.key === "newFollowers" ? "insightsOverview.notEnoughFollowers" : "insightsOverview.notEnoughPosts")}</p>
        </>
      ) : (
        <>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className="text-heading font-bold tabular-nums" data-testid="metric-value">
              {value(m.current!)}
            </span>
            {m.changePct !== null && <SignedPct value={m.changePct} className="text-body" />}
          </p>
          <p className="mt-0.5 text-caption text-muted" data-testid="metric-compare">
            {m.state === "ok" && m.previous !== null ? t("insightsOverview.vsBefore", { value: value(m.previous) }) : t("insightsOverview.noCompare")}
          </p>
          <p className="mt-0.5 text-caption text-muted" data-testid="metric-based-on">
            {basedOn}
          </p>
        </>
      )}
      <p className="mt-1 text-caption text-muted">{t(`insightsOverview.metricHints.${m.key}`)}</p>
      <SeeDetails href={href} name={name} className="mt-auto pt-2" />
    </li>
  );
}

function SeeDetails({ href, name, className }: { href: string; name: string; className?: string }) {
  const { t } = useI18n();
  return (
    <Link href={href} className={cn("inline-flex w-fit items-center gap-0.5 text-body font-semibold text-primary hover:underline", className)} aria-label={t("insightsOverview.seeDetailsOf", { name })} data-testid="see-details">
      {t("insightsOverview.seeDetails")}
      <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
    </Link>
  );
}

/** This week's tips, the same cards and buttons as Recommendations. */
function NextActions() {
  const { t } = useI18n();
  const { isPreview } = useActiveClient();
  const recs = useRecommendations();
  const title = t("insightsOverview.actionsTitle");

  let body: React.ReactNode;
  if (isPreview) body = <p className="text-body text-muted">{t("insightsOverview.actionsPreview")}</p>;
  else if (recs.isPending) body = <SkeletonList rows={2} />;
  else if (recs.isError) body = <ErrorState error={recs.error} onRetry={() => recs.refetch()} />;
  else if (!recs.data.current.length)
    body = (
      <p className="rounded-card border border-border bg-background p-4 text-body text-muted" data-testid="overview-no-tips">
        {t(recs.data.lastAnalysis ? "recommendations.sections.currentEmpty" : "insightsOverview.actionsEmpty")}
      </p>
    );
  else
    body = (
      <ol className="space-y-3">
        {recs.data.current.slice(0, 3).map((r, i) => (
          <li key={r.id}>
            <TipCard rec={r} n={i + 1} />
          </li>
        ))}
      </ol>
    );

  return (
    <section aria-labelledby="overview-actions" data-testid="overview-actions">
      <SectionTitle action={<SeeDetails href="/recommendations" name={title} />}>
        <span id="overview-actions">{title}</span>
      </SectionTitle>
      {body}
    </section>
  );
}

function Summary({ summary, href }: { summary: OverviewSummary | null; href: string }) {
  const { t, locale } = useI18n();
  const title = t("insightsOverview.summaryTitle");
  const n = (v: number) => formatNumber(v, locale);
  const pct = (v: number) => new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 1 }).format(v);

  const sentences: string[] = [];
  if (summary) {
    const lead = summary.lead;
    if (lead.kind === "change") sentences.push(t(`insightsOverview.summary.${lead.direction}`, { metric: t(`insightsOverview.summaryMetric.${lead.metric}`), pct: pct(lead.pct) }));
    else if (lead.kind === "followers")
      sentences.push(t(lead.change > 0 ? "insightsOverview.summary.followersUp" : lead.change < 0 ? "insightsOverview.summary.followersDown" : "insightsOverview.summary.followersFlat", { count: n(Math.abs(lead.change)) }));
    else sentences.push(t("insightsOverview.summary.posts", { current: n(lead.current), previous: n(lead.previous) }));
    if (summary.best) sentences.push(t("insightsOverview.summary.best", { days: n(BEST_FORMAT_DAYS), format: t(`insightsOverview.formatsInSentence.${summary.best.format}`), avg: n(summary.best.avgInteractions), count: n(summary.best.posts) }));
  }

  return (
    <section aria-labelledby="overview-summary" data-testid="overview-summary">
      <SectionTitle action={<SeeDetails href={href} name={title} />}>
        <span id="overview-summary">{title}</span>
      </SectionTitle>
      <div className="rounded-card border border-border bg-background p-4">
        {summary ? (
          <>
            <p className="text-body" data-testid="summary-text">
              {sentences.join(" ")}
            </p>
            <p className="mt-2 text-caption text-muted" data-testid="summary-based-on">
              {t("insightsOverview.summary.basedOn", { total: n(summary.posts.current + summary.posts.previous), current: n(summary.posts.current), previous: n(summary.posts.previous) })}
            </p>
          </>
        ) : (
          <p className="text-body text-muted" data-testid="summary-not-enough">
            {t("insightsOverview.summaryNotEnough")}
          </p>
        )}
      </div>
    </section>
  );
}

function OverviewSkeleton() {
  return (
    <div aria-busy="true">
      <div className="mb-6 space-y-2.5">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-36 rounded-card" />
        ))}
      </div>
      <SkeletonList rows={3} />
    </div>
  );
}
