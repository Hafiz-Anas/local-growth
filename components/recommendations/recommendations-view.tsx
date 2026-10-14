"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, CheckCheck, Lightbulb, Loader2, RefreshCw, RotateCcw, X } from "lucide-react";
import { useActiveClient } from "@/components/providers/active-client-provider";
import { PageHeader, SectionTitle } from "@/components/shared/page-header";
import { EmptyState, ErrorState, SkeletonList } from "@/components/shared/states";
import { TimeAgo } from "@/components/shared/time-ago";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { qk, useAction, useRecommendations } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { cn, formatDateTime, formatNumber } from "@/lib/utils";
import type { RecommendationDto, RecommendationOutcomeDto, RecommendationStatusKey, RecommendationsDto, RecommendationsRefreshDto } from "@/types";

const CONFIDENCE_BADGE = { strong: "success", moderate: "warning", early: "neutral" } as const;

/** Why the AI couldn't analyse, from a 503 recommendations_unavailable. */
function unavailableReason(error: ApiClientError): string | null {
  const detail = Array.isArray(error.details) ? (error.details as Array<{ path?: string; message?: string }>).find((d) => d.path === "reason") : undefined;
  return detail?.message ?? null;
}

/**
 * AI strategy recommendations: 3–5 concrete actions from the weekly analysis
 * (or a manual refresh), each with its rationale, confidence and the posts it
 * rests on. The owner accepts, dismisses or marks them done; done ones show
 * an honest before/after comparison after 7 days.
 */
export function RecommendationsView() {
  const { t, locale } = useI18n();
  const { isPreview } = useActiveClient();
  const queryClient = useQueryClient();
  const recs = useRecommendations();
  const [notice, setNotice] = useState<{ tone: "info" | "alert"; text: string } | null>(null);

  const refresh = useAction({
    mutationFn: () => apiFetch<RecommendationsRefreshDto>("/api/recommendations/refresh", { method: "POST" }),
    meta: { handlesErrors: true },
    onMutate: () => setNotice(null),
    onSuccess: (res) => {
      queryClient.setQueryData(qk.recommendations, res.data);
      setNotice(res.result === "unchanged" ? { tone: "info", text: t("recommendations.notice.unchanged") } : null);
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.code === "recommendations_unavailable") {
        const reason = unavailableReason(error);
        setNotice({ tone: "alert", text: t(reason === "rate_limited" ? "recommendations.notice.busy" : reason === "daily_limit" ? "recommendations.notice.today" : "recommendations.notice.unavailable") });
      } else if (error instanceof ApiClientError && error.code === "recommendations_limit") {
        setNotice({ tone: "alert", text: t("recommendations.notice.limit", { limit: recs.data?.refresh.limit ?? 0 }) });
      } else if (error instanceof ApiClientError && error.code === "instagram_not_connected") {
        setNotice({ tone: "alert", text: t("recommendations.notice.noData") });
      } else {
        setNotice({ tone: "alert", text: errorMessage(error, t) });
      }
    },
  });

  if (isPreview) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title={t("recommendations.title")} />
        <EmptyState icon={Lightbulb} title={t("recommendations.title")} hint={t("recommendations.previewHint")} />
      </div>
    );
  }

  const data = recs.data;
  const left = data ? Math.max(0, data.refresh.limit - data.refresh.used) : 0;
  const refreshButton = (
    <Button onClick={() => refresh.mutate()} disabled={refresh.isPending || !data || left === 0} className="gap-1.5">
      {refresh.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-4" aria-hidden="true" />}
      {refresh.isPending ? t("recommendations.analysing") : t("recommendations.refresh")}
    </Button>
  );

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("recommendations.title")} subtitle={t("recommendations.subtitle")} actions={data?.lastAnalysis ? refreshButton : undefined} />

      {recs.isPending ? (
        <SkeletonList rows={3} />
      ) : recs.isError ? (
        <ErrorState error={recs.error} onRetry={() => recs.refetch()} />
      ) : (
        <>
          <Meta data={data!} left={left} />
          {notice && (
            <p className={cn("mb-4 rounded-card border border-border px-3 py-2 text-body", notice.tone === "alert" ? "bg-hover" : "bg-primary-soft")} role={notice.tone === "alert" ? "alert" : "status"} data-testid="recommendations-notice">
              {notice.text}
            </p>
          )}

          {!data!.lastAnalysis ? (
            <EmptyState icon={Lightbulb} title={t("recommendations.emptyTitle")} hint={t("recommendations.emptyHint")} action={refreshButton} />
          ) : (
            <div className="space-y-8">
              <Section title={t("recommendations.sections.current")} items={data!.current} empty={t("recommendations.sections.currentEmpty")} />
              <Section title={t("recommendations.sections.inProgress")} items={data!.inProgress} />
              <Section title={t("recommendations.sections.done")} items={data!.done} />
              {data!.dismissed.length > 0 && (
                <details className="group">
                  <summary className="cursor-pointer text-title font-bold">
                    {t("recommendations.sections.dismissed")} ({formatNumber(data!.dismissed.length, locale)})
                  </summary>
                  <div className="mt-3 space-y-3">
                    {data!.dismissed.map((r) => (
                      <RecommendationCard key={r.id} rec={r} />
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
          <p className="mt-8 text-caption text-muted">{t("recommendations.disclaimer")}</p>
        </>
      )}
    </div>
  );
}

function Meta({ data, left }: { data: RecommendationsDto; left: number }) {
  const { t, locale } = useI18n();
  if (!data.lastAnalysis) return null;
  const checkedSince = data.lastCheckedAt && data.lastCheckedAt !== data.lastAnalysis.at;
  return (
    <p className="mb-4 flex flex-wrap gap-x-3 gap-y-1 text-caption text-muted">
      <span>
        {t("recommendations.meta.analysed")} <TimeAgo iso={data.lastAnalysis.at} />
        {checkedSince && (
          <>
            {" · "}
            {t("recommendations.meta.checked")} <TimeAgo iso={data.lastCheckedAt!} />
          </>
        )}
      </span>
      {data.nextScheduledAt && <span>{t("recommendations.meta.next", { date: formatDateTime(data.nextScheduledAt, locale, { day: "numeric", month: "short" }) })}</span>}
      <span>{t("recommendations.meta.refreshes", { left, limit: data.refresh.limit })}</span>
    </p>
  );
}

function Section({ title, items, empty }: { title: string; items: RecommendationDto[]; empty?: string }) {
  if (!items.length && !empty) return null;
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      {items.length ? (
        <div className="space-y-3">
          {items.map((r) => (
            <RecommendationCard key={r.id} rec={r} />
          ))}
        </div>
      ) : (
        <p className="text-body text-muted">{empty}</p>
      )}
    </section>
  );
}

function RecommendationCard({ rec }: { rec: RecommendationDto }) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const date = (iso: string) => formatDateTime(iso, locale, { day: "numeric", month: "short" });
  const decide = useAction({
    mutationFn: (status: RecommendationStatusKey) => apiFetch<RecommendationDto>(`/api/recommendations/${rec.id}`, { method: "PATCH", body: { status } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.recommendations }),
  });
  const busy = decide.isPending;
  const action = (status: RecommendationStatusKey, label: string, icon: React.ReactNode, variant: "primary" | "secondary" | "ghost" = "secondary") => (
    <Button size="sm" variant={variant} className="gap-1.5" disabled={busy} onClick={() => decide.mutate(status)}>
      {icon}
      {label}
    </Button>
  );

  return (
    <article className="rounded-card border border-border bg-background p-4" data-testid="recommendation" data-status={rec.status}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge variant={CONFIDENCE_BADGE[rec.confidence]}>{t(`recommendations.confidence.${rec.confidence}`)}</Badge>
        <span className="text-caption text-muted">
          {rec.basedOnPosts > 0 ? t("recommendations.basedOn", { count: formatNumber(rec.basedOnPosts, locale) }) : t("recommendations.basedOnNone")}
        </span>
        <span className="text-caption text-muted">· {t(`recommendations.categories.${rec.category}`)}</span>
      </div>
      <h3 className="text-body font-semibold" dir="auto">
        {rec.action[locale]}
      </h3>
      <p className="mt-1 text-body text-muted" dir="auto">
        {rec.rationale[locale]}
      </p>

      {rec.status === "done" && <Outcome rec={rec} />}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {rec.status === "new" && (
          <>
            {action("accepted", t("recommendations.actions.accept"), <Check className="size-4" aria-hidden="true" />, "primary")}
            {action("done", t("recommendations.actions.done"), <CheckCheck className="size-4" aria-hidden="true" />)}
            {action("dismissed", t("recommendations.actions.dismiss"), <X className="size-4" aria-hidden="true" />, "ghost")}
          </>
        )}
        {rec.status === "accepted" && (
          <>
            <span className="text-caption text-muted">{t("recommendations.status.accepted", { date: date(rec.statusAt!) })}</span>
            {action("done", t("recommendations.actions.done"), <CheckCheck className="size-4" aria-hidden="true" />, "primary")}
            {action("dismissed", t("recommendations.actions.dismiss"), <X className="size-4" aria-hidden="true" />, "ghost")}
          </>
        )}
        {rec.status === "dismissed" && (
          <>
            <span className="text-caption text-muted">{t("recommendations.status.dismissed", { date: date(rec.statusAt!) })}</span>
            {action("new", t("recommendations.actions.restore"), <RotateCcw className="size-4" aria-hidden="true" />, "ghost")}
          </>
        )}
        {rec.status === "done" && <span className="text-caption text-muted">{t("recommendations.status.done", { date: date(rec.statusAt!) })}</span>}
      </div>
    </article>
  );
}

const fmt = (value: number | null, metric: RecommendationOutcomeDto["metric"], locale: "en" | "ar") =>
  value === null ? "—" : formatNumber(metric === "interactions" ? Math.round(value * 10) / 10 : Math.round(value), locale);

/** The 7-day comparison: pending until due, then honest about what changed (or didn't). */
function Outcome({ rec }: { rec: RecommendationDto }) {
  const { t, locale } = useI18n();
  const metric = t(`recommendations.metrics.${rec.metric}`);
  const o = rec.outcome;
  if (!o) {
    return (
      <p className="mt-3 rounded-card bg-hover px-3 py-2 text-caption" data-testid="outcome-pending">
        {t("recommendations.outcome.pending", { metric, date: formatDateTime(rec.outcomeDueAt!, locale, { day: "numeric", month: "short" }) })}
      </p>
    );
  }
  const change = o.changePct === null ? "" : `${o.changePct > 0 ? "+" : ""}${formatNumber(o.changePct, locale)}%`;
  return (
    <div className="mt-3 rounded-card bg-hover px-3 py-2 text-caption" data-testid="outcome">
      <p className="font-semibold">
        {o.verdict === "not_enough_data"
          ? t("recommendations.outcome.notEnough", { metric })
          : o.verdict === "no_clear_change"
            ? t("recommendations.outcome.noChange", { metric, change })
            : t(o.verdict === "up" ? "recommendations.outcome.up" : "recommendations.outcome.down", { metric, change })}
      </p>
      {o.verdict !== "not_enough_data" && (
        <p className="mt-0.5">
          <bdi>{fmt(o.before, o.metric, locale)}</bdi> → <bdi>{fmt(o.after, o.metric, locale)}</bdi>
        </p>
      )}
      <p className="mt-0.5 text-muted">
        {o.metric === "followers" ? t("recommendations.outcome.followersNote") : t("recommendations.outcome.postsNote", { before: o.postsBefore, after: o.postsAfter })}{" "}
        {t("recommendations.outcome.correlation")}
      </p>
    </div>
  );
}
