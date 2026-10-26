"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, Lightbulb, Loader2, Minus, RefreshCw, RotateCcw, TrendingDown, TrendingUp, X } from "lucide-react";
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

const IMPACT_BADGE = { high: "success", medium: "warning", low: "neutral" } as const;

/** Why the AI couldn't analyse, from a 503 recommendations_unavailable. */
function errorDetail(error: ApiClientError, path: string): string | null {
  const detail = Array.isArray(error.details) ? (error.details as Array<{ path?: string; message?: string }>).find((d) => d.path === path) : undefined;
  return detail?.message ?? null;
}

/**
 * Weekly tips: at most 3 cards from the latest analysis, highest expected impact first — the
 * action on top, a short "Why" line with the owner's own numbers, the impact label and "Mark as
 * done". "Last week's results" shows, for tips marked done, what changed 7 days later (or that
 * there isn't enough data to tell).
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
        const reason = errorDetail(error, "reason");
        setNotice({ tone: "alert", text: t(reason === "rate_limited" ? "recommendations.notice.busy" : reason === "daily_limit" ? "recommendations.notice.today" : "recommendations.notice.unavailable") });
      } else if (error instanceof ApiClientError && error.code === "recommendations_limit") {
        setNotice({ tone: "alert", text: t("recommendations.notice.limit", { limit: recs.data?.refresh.limit ?? 0 }) });
      } else if (error instanceof ApiClientError && error.code === "instagram_not_connected") {
        setNotice({ tone: "alert", text: t("recommendations.notice.noData") });
      } else if (error instanceof ApiClientError && error.code === "recommendations_week_set") {
        // Another tab or a stale page: show when the next set comes and reload the allowance.
        const at = errorDetail(error, "nextSetAt");
        setNotice({ tone: "info", text: at ? t("recommendations.notice.weekSet", { date: formatDateTime(at, locale, { day: "numeric", month: "short" }) }) : errorMessage(error, t) });
        queryClient.invalidateQueries({ queryKey: qk.recommendations });
      } else if (error instanceof ApiClientError && error.code === "recommendations_not_enough_data") {
        setNotice({ tone: "info", text: t("recommendations.notice.notEnough") });
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
    <Button onClick={() => refresh.mutate()} disabled={refresh.isPending || !data || left === 0 || !!data.refresh.nextSetAt} className="gap-1.5">
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
              <section aria-labelledby="tips-heading">
                <SectionTitle>
                  <span id="tips-heading">{t("recommendations.sections.current")}</span>
                </SectionTitle>
                {data!.current.length ? (
                  <ol className="space-y-3">
                    {data!.current.map((r, i) => (
                      <li key={r.id}>
                        <TipCard rec={r} n={i + 1} />
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-body text-muted">{t("recommendations.sections.currentEmpty")}</p>
                )}
              </section>

              {data!.inProgress.length > 0 && (
                <section>
                  <SectionTitle>{t("recommendations.sections.inProgress")}</SectionTitle>
                  <div className="space-y-3">
                    {data!.inProgress.map((r) => (
                      <TipCard key={r.id} rec={r} />
                    ))}
                  </div>
                </section>
              )}

              <Results items={data!.done} />

              {data!.dismissed.length > 0 && (
                <details className="group">
                  <summary className="cursor-pointer text-title font-bold">
                    {t("recommendations.sections.dismissed")} ({formatNumber(data!.dismissed.length, locale)})
                  </summary>
                  <div className="mt-3 space-y-3">
                    {data!.dismissed.map((r) => (
                      <TipCard key={r.id} rec={r} />
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
      {data.refresh.nextSetAt ? (
        // One set of tips a week: Refresh stays off until then.
        <span data-testid="next-set">{t("recommendations.meta.nextSet", { date: formatDateTime(data.refresh.nextSetAt, locale, { day: "numeric", month: "short" }) })}</span>
      ) : (
        <>
          {data.nextScheduledAt && <span>{t("recommendations.meta.next", { date: formatDateTime(data.nextScheduledAt, locale, { day: "numeric", month: "short" }) })}</span>}
          <span>{t("recommendations.meta.refreshes", { left, limit: data.refresh.limit })}</span>
        </>
      )}
    </p>
  );
}

function useDecide(id: string) {
  const queryClient = useQueryClient();
  return useAction({
    mutationFn: (status: RecommendationStatusKey) => apiFetch<RecommendationDto>(`/api/recommendations/${id}`, { method: "PATCH", body: { status } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.recommendations }),
  });
}

/** One tip: the action on top, "Why" with the numbers, the impact label, and Mark as done. */
function TipCard({ rec, n }: { rec: RecommendationDto; n?: number }) {
  const { t, locale } = useI18n();
  const decide = useDecide(rec.id);
  const busy = decide.isPending;
  const date = (iso: string) => formatDateTime(iso, locale, { day: "numeric", month: "short" });

  return (
    <article className="rounded-card border border-border bg-background p-4" data-testid="recommendation" data-status={rec.status} data-impact={rec.impact ?? ""}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {n !== undefined && <span className="text-caption font-semibold text-muted">{t("recommendations.tipNumber", { n: formatNumber(n, locale) })}</span>}
        {rec.impact && (
          <Badge variant={IMPACT_BADGE[rec.impact]} data-testid="impact">
            {t(`recommendations.impact.${rec.impact}`)}
          </Badge>
        )}
        <Badge variant="outline" size="sm">
          {t(`recommendations.categories.${rec.category}`)}
        </Badge>
      </div>

      <h3 className="text-title font-semibold leading-snug" dir="auto">
        {rec.action[locale]}
      </h3>
      <p className="mt-2 text-body" data-testid="why">
        <span className="font-semibold">{t("recommendations.why")}</span>{" "}
        <span className="text-muted" dir="auto">
          {rec.rationale[locale]}
        </span>
      </p>
      <p className="mt-1 text-caption text-muted">
        {rec.basedOnPosts > 0 ? t("recommendations.basedOn", { count: formatNumber(rec.basedOnPosts, locale) }) : t("recommendations.basedOnNone")}
        {" · "}
        {t(`recommendations.confidence.${rec.confidence}`)}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(rec.status === "new" || rec.status === "accepted") && (
          <>
            {rec.status === "accepted" && <span className="text-caption text-muted">{t("recommendations.status.accepted", { date: date(rec.statusAt!) })}</span>}
            <Button size="sm" className="gap-1.5" disabled={busy} onClick={() => decide.mutate("done")}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="size-4" aria-hidden="true" />}
              {t("recommendations.actions.done")}
            </Button>
            <Button size="sm" variant="ghost" className="gap-1.5" disabled={busy} onClick={() => decide.mutate("dismissed")}>
              <X className="size-4" aria-hidden="true" />
              {t("recommendations.actions.dismiss")}
            </Button>
          </>
        )}
        {rec.status === "dismissed" && (
          <>
            <span className="text-caption text-muted">{t("recommendations.status.dismissed", { date: date(rec.statusAt!) })}</span>
            <Button size="sm" variant="ghost" className="gap-1.5" disabled={busy} onClick={() => decide.mutate("new")}>
              <RotateCcw className="size-4" aria-hidden="true" />
              {t("recommendations.actions.restore")}
            </Button>
          </>
        )}
      </div>
    </article>
  );
}

/** "Last week's results": every tip marked done, with what changed after 7 days. */
function Results({ items }: { items: RecommendationDto[] }) {
  const { t } = useI18n();
  return (
    <section data-testid="results">
      <SectionTitle>{t("recommendations.sections.results")}</SectionTitle>
      {items.length ? (
        <>
          <p className="-mt-1 mb-3 text-caption text-muted">{t("recommendations.sections.resultsHint")}</p>
          <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-background">
            {items.map((r) => (
              <ResultRow key={r.id} rec={r} />
            ))}
          </ul>
          <p className="mt-2 text-caption text-muted">{t("recommendations.outcome.correlation")}</p>
        </>
      ) : (
        <p className="text-body text-muted">{t("recommendations.sections.resultsEmpty")}</p>
      )}
    </section>
  );
}

const fmt = (value: number | null, metric: RecommendationOutcomeDto["metric"], locale: "en" | "ar") =>
  value === null ? "—" : formatNumber(metric === "reach" || metric === "followers" ? Math.round(value) : Math.round(value * 10) / 10, locale);

function ResultRow({ rec }: { rec: RecommendationDto }) {
  const { t, locale } = useI18n();
  const o = rec.outcome;
  const name = t(`recommendations.metricNames.${rec.metric}`);
  const doneOn = rec.statusAt ? t("recommendations.status.done", { date: formatDateTime(rec.statusAt, locale, { day: "numeric", month: "short" }) }) : null;

  let icon: React.ReactNode;
  let headline: string;
  let tone: string;
  let detail: string | null = null;
  if (!o) {
    icon = <Clock className="size-5" aria-hidden="true" />;
    tone = "text-muted";
    headline = t("recommendations.outcome.pending", { date: formatDateTime(rec.outcomeDueAt!, locale, { day: "numeric", month: "short" }) });
    detail = t("recommendations.outcome.pendingHint", { metric: t(`recommendations.metrics.${rec.metric}`) });
  } else if (o.verdict === "not_enough_data") {
    icon = <Minus className="size-5" aria-hidden="true" />;
    tone = "text-muted";
    headline = t("recommendations.outcome.notEnough");
    detail = o.metric === "followers" ? null : t("recommendations.outcome.notEnoughHint");
  } else {
    const change = `${formatNumber(Math.abs(o.changePct!), locale)}%`;
    icon = o.verdict === "up" ? <TrendingUp className="size-5" aria-hidden="true" /> : o.verdict === "down" ? <TrendingDown className="size-5" aria-hidden="true" /> : <Minus className="size-5" aria-hidden="true" />;
    tone = o.verdict === "up" ? "text-success" : o.verdict === "down" ? "text-danger" : "text-muted";
    headline =
      o.verdict === "no_clear_change"
        ? t("recommendations.outcome.noChange", { metric: name, change: `${o.changePct! > 0 ? "+" : o.changePct! < 0 ? "−" : ""}${change}` })
        : t(o.verdict === "up" ? "recommendations.outcome.up" : "recommendations.outcome.down", { metric: name, change });
    const before = fmt(o.before, o.metric, locale);
    const after = fmt(o.after, o.metric, locale);
    detail =
      o.metric === "followers"
        ? t("recommendations.outcome.followersBeforeAfter", { before, after })
        : `${t("recommendations.outcome.beforeAfter", { before, after })} · ${t("recommendations.outcome.postsNote", { before: formatNumber(o.postsBefore, locale), after: formatNumber(o.postsAfter, locale) })}`;
  }

  return (
    <li className="flex gap-3 p-4" data-testid="result" data-verdict={o?.verdict ?? "pending"}>
      <span className={cn("mt-0.5 shrink-0", tone)}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-body font-semibold", tone === "text-muted" ? "text-foreground" : tone)} data-testid="result-headline">
          {headline}
        </p>
        {detail && <p className="mt-0.5 text-caption text-muted">{detail}</p>}
        <p className="mt-1.5 text-caption text-muted" dir="auto" data-testid="result-action">
          {rec.action[locale]}
        </p>
        {doneOn && <p className="mt-0.5 text-caption text-muted">{doneOn}</p>}
      </div>
    </li>
  );
}
