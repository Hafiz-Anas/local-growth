"use client";

import { FileText } from "lucide-react";
import { useActiveClient } from "@/components/providers/active-client-provider";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, SkeletonList } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { useReports } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { cn, formatDateTime, formatNumber } from "@/lib/utils";
import type { ReportCompare, ReportPost, WeeklyReportDto } from "@/types";

/** Weekly reports, newest first: the latest open, earlier weeks collapsed. */
export function ReportsView() {
  const { t } = useI18n();
  const { isPreview } = useActiveClient();
  const reports = useReports();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("reports.title")} subtitle={t("reports.subtitle")} />
      {isPreview ? (
        <EmptyState icon={FileText} title={t("reports.title")} hint={t("reports.previewHint")} />
      ) : reports.isPending ? (
        <SkeletonList rows={3} />
      ) : reports.isError ? (
        <ErrorState error={reports.error} onRetry={() => reports.refetch()} />
      ) : !reports.data.length ? (
        <EmptyState icon={FileText} title={t("reports.emptyTitle")} hint={t("reports.emptyHint")} />
      ) : (
        <div className="space-y-4">
          <Report report={reports.data[0]} open />
          {reports.data.length > 1 && <h2 className="pt-4 text-title font-bold">{t("reports.earlier")}</h2>}
          {reports.data.slice(1).map((r) => (
            <Report key={r.id} report={r} />
          ))}
          <p className="pt-4 text-caption text-muted">{t("reports.disclaimer")}</p>
        </div>
      )}
    </div>
  );
}

function Report({ report, open = false }: { report: WeeklyReportDto; open?: boolean }) {
  const { t, locale } = useI18n();
  const n = report.numbers;
  const day = (iso: string) => formatDateTime(iso, locale, { day: "numeric", month: "short" });
  // periodEnd is exclusive (midnight); show the last day of the week.
  const lastDay = new Date(Date.parse(n.periodEnd) - 1).toISOString();
  return (
    <details open={open} id={report.id} className="group rounded-panel border border-border" data-testid="weekly-report">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 p-4">
        <span className="text-title font-bold">
          {t("reports.week", { start: day(n.periodStart), end: day(lastDay) })}
        </span>
        {n.quality.demo && <Badge variant="blue">{t("reports.quality.demo")}</Badge>}
        {n.quality.thin && <Badge variant="warning">{t("reports.quality.thin")}</Badge>}
      </summary>
      <div className="space-y-4 px-4 pb-4">
        {report.summary ? (
          <p className="text-body" dir="auto" data-testid="report-summary">
            {report.summary[locale]}
          </p>
        ) : (
          <p className="rounded-card bg-hover px-3 py-2 text-caption" data-testid="report-numbers-only">
            {t("reports.numbersOnly")}
          </p>
        )}
        {n.quality.thin && <p className="text-caption text-muted">{t("reports.thinNote")}</p>}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[22rem] text-body">
            <thead>
              <tr className="text-caption text-muted">
                <th className="py-1.5 text-start font-normal">{t("reports.columns.metric")}</th>
                <th className="py-1.5 text-end font-normal">{t("reports.columns.thisWeek")}</th>
                <th className="py-1.5 text-end font-normal">{t("reports.columns.previous")}</th>
                <th className="py-1.5 text-end font-normal">{t("reports.columns.change")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-separator">
              <Row label={t("reports.metrics.posts")} c={n.posts} />
              <Row label={t("reports.metrics.reach")} c={n.reach} />
              <Row label={t("reports.metrics.avgInteractions")} c={n.avgInteractions} />
              <Row label={t("reports.metrics.engagementRate")} c={n.engagementRate} unit="%" />
              <Row label={t("reports.metrics.followerChange")} c={n.followerChange} signed />
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <PostBox label={t("reports.top")} post={n.top} empty={t("reports.noPosts")} />
          {n.weakest && <PostBox label={t("reports.weakest")} post={n.weakest} />}
        </div>
      </div>
    </details>
  );
}

function Row({ label, c, unit = "", signed = false }: { label: string; c: ReportCompare; unit?: string; signed?: boolean }) {
  const { t, locale } = useI18n();
  const fmt = (v: number | null) => (v === null ? "—" : `${signed && v > 0 ? "+" : ""}${formatNumber(v, locale)}${unit}`);
  return (
    <tr>
      <td className="py-2">{label}</td>
      <td className="py-2 text-end font-semibold"><bdi>{fmt(c.current)}</bdi></td>
      <td className="py-2 text-end text-muted"><bdi>{fmt(c.previous)}</bdi></td>
      <td className={cn("py-2 text-end", c.changePct !== null && (c.changePct > 0 ? "text-success" : c.changePct < 0 ? "text-danger" : ""))}>
        <bdi>{c.changePct === null ? t("reports.noChangeData") : `${c.changePct > 0 ? "+" : ""}${formatNumber(c.changePct, locale)}%`}</bdi>
      </td>
    </tr>
  );
}

function PostBox({ label, post, empty }: { label: string; post: ReportPost | null; empty?: string }) {
  const { t, locale } = useI18n();
  return (
    <div className="rounded-card bg-hover p-3">
      <p className="text-caption text-muted">{label}</p>
      {post ? (
        <>
          <p className="text-body font-semibold">
            {formatDateTime(post.postedAt, locale, { day: "numeric", month: "short" })} · {t(`reports.postType.${post.type}`)}
          </p>
          <p className="text-caption">
            {t("reports.postNumbers", { likes: formatNumber(post.likes, locale), comments: formatNumber(post.comments, locale) })}
            {post.reach > 0 && ` · ${t("reports.postReach", { reach: formatNumber(post.reach, locale) })}`}
          </p>
          {post.caption && (
            <p className="mt-1 line-clamp-2 text-caption text-muted" dir="auto">
              {post.caption}
            </p>
          )}
        </>
      ) : (
        <p className="text-body">{empty}</p>
      )}
    </div>
  );
}
