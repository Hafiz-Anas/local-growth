"use client";

import Link from "next/link";
import { ChevronRight, Send } from "lucide-react";
import { ErrorState, Skeleton, SkeletonList } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SHARE_MIN_POSTS, SHARE_MIN_POSTS_FOR_PATTERNS, SHARE_MIN_REACH } from "@/lib/analysis/shareability";
import { qk, useShareability } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { formatNumber, intlLocale } from "@/lib/utils";
import type { AiTextState, PostShareRate, ShareFinding } from "@/types";
import { AiExplanation, MeasuredBadge, PostThumb } from "./shared";

/** A share rate for display, as computed (up to two decimals: "0.45%", "1.57%"), so it matches the findings' numbers. */
export function useSharePct() {
  const { locale } = useI18n();
  return (pct: number) => `${new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 2 }).format(pct)}%`;
}

/** "3× your average", "About your average" — or nothing without an average. */
export function useTimesAverage() {
  const { t, locale } = useI18n();
  return (times: number | null) => {
    if (times === null) return null;
    if (times >= 0.95 && times < 1.05) return t("shareability.aboutAverage");
    return t("shareability.timesAverage", { value: formatNumber(times, locale) });
  };
}

/**
 * Post performance → "Most shared" (feature postInsights.shareability): the posts people send to
 * friends most, as shares ÷ reach against the account's average, and the AI's findings on what they
 * have in common. Without share numbers from Instagram it quietly says "Not available yet".
 */
export function MostSharedCard() {
  const { t, locale } = useI18n();
  const query = useShareability();
  const pct = useSharePct();
  const times = useTimesAverage();

  if (query.isPending) {
    return (
      <div className="mt-6 space-y-3" aria-busy="true">
        <Skeleton className="h-5 w-40" />
        <div className="rounded-panel border border-border">
          <SkeletonList rows={3} />
        </div>
      </div>
    );
  }
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} className="mt-6" />;
  const d = query.data;
  if (!d.connected) return null;

  return (
    <section className="mt-6" data-testid="most-shared">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-title font-bold">{t("shareability.title")}</h2>
        <MeasuredBadge />
      </div>
      <p className="mb-3 text-caption text-muted">
        {d.averagePct !== null ? t("shareability.hint", { average: pct(d.averagePct), posts: d.posts }) : t("shareability.hintNoAverage")}
      </p>

      {d.status !== "ready" ? (
        <Card className="p-4" data-testid="most-shared-unavailable">
          <p className="text-body font-semibold">{t("shareability.notYet")}</p>
          <p className="mt-0.5 text-caption text-muted">{t(`shareability.notYetHint.${d.status}`, { minReach: formatNumber(d.minReach, locale), minPosts: d.minPosts })}</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-separator">
            {d.mostShared.map((p, i) => (
              <li key={p.id}>
                <Link href={`/post-performance/${encodeURIComponent(p.id)}`} className="flex items-center gap-3 px-4 py-3 hover:bg-hover" data-testid="most-shared-post">
                  <span className="w-4 shrink-0 text-center text-caption font-semibold text-muted tabular-nums">{formatNumber(i + 1, locale)}</span>
                  <PostThumb post={{ id: p.id, caption: p.caption, mediaUrl: p.mediaUrl }} className="size-12" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body" dir="auto">
                      {p.caption || t("postPerformance.noCaption")}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-caption text-muted tabular-nums">
                      <span>{t(`analysis.format.${p.format}`)}</span>
                      <span className="flex items-center gap-0.5">
                        <Send className="size-3 rtl:-scale-x-100" aria-hidden="true" />
                        {t("shareability.sharesOfReach", { shares: formatNumber(p.shares, locale), reach: formatNumber(p.reach, locale) })}
                      </span>
                    </p>
                  </div>
                  <div className="shrink-0 text-end">
                    <p className="text-body font-semibold tabular-nums" data-testid="most-shared-rate">
                      {pct(p.ratePct)}
                    </p>
                    {times(p.vsAverage) && (
                      <Badge variant="blue" size="sm" data-testid="most-shared-times">
                        {times(p.vsAverage)}
                      </Badge>
                    )}
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted rtl:-scale-x-100" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          {d.excluded.lowReach > 0 && (
            <p className="border-t border-separator px-4 py-2.5 text-caption text-muted">{t("shareability.lowReachNote", { count: d.excluded.lowReach, minReach: formatNumber(d.minReach, locale) })}</p>
          )}
        </Card>
      )}

      {d.status === "ready" && <Findings findings={d.findings} />}
    </section>
  );
}

function Findings({ findings }: { findings: AiTextState<ShareFinding[]> }) {
  const { t, locale } = useI18n();
  if (findings.status === "unavailable" && findings.reason === "not_enough_posts") {
    return (
      <Card className="mt-4 p-4" data-testid="share-findings-soon">
        <h3 className="text-body font-semibold">{t("shareability.findingsTitle")}</h3>
        <p className="mt-0.5 text-caption text-muted">{t("shareability.findingsSoon", { count: SHARE_MIN_POSTS_FOR_PATTERNS })}</p>
      </Card>
    );
  }
  return (
    <AiExplanation<ShareFinding[]>
      className="mt-4"
      queryKey={qk.shareability}
      url="/api/shareability/findings"
      state={findings}
      title={t("shareability.findingsTitle")}
      render={(items) => (
        <ul className="space-y-2.5" data-testid="share-findings">
          {items.map((f, i) => (
            <li key={i} className="flex gap-2 text-body" dir="auto">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
              <span>{locale === "ar" ? f.ar : f.en}</span>
            </li>
          ))}
        </ul>
      )}
    />
  );
}

/** A post's share rate on its detail page: shares ÷ reach vs the account's average, or why there's none. */
export function ShareRateCard({ shareRate }: { shareRate: PostShareRate | null }) {
  const { t, locale } = useI18n();
  const pct = useSharePct();
  const times = useTimesAverage();
  const status = shareRate?.status ?? "unavailable";

  return (
    <Card className="p-4" data-testid="post-share-rate">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-title font-bold">{t("shareability.rateTitle")}</h2>
        <MeasuredBadge />
      </div>
      {status === "ok" && shareRate?.ratePct !== null && shareRate ? (
        <>
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-heading font-bold tabular-nums" data-testid="post-share-rate-value">
              {pct(shareRate.ratePct!)}
            </span>
            <span className="text-body text-muted">{t("shareability.rateMeaning")}</span>
          </p>
          <p className="mt-1 text-caption text-muted tabular-nums">{t("shareability.sharesOfReach", { shares: formatNumber(shareRate.shares ?? 0, locale), reach: formatNumber(shareRate.reach ?? 0, locale) })}</p>
          {shareRate.averagePct !== null ? (
            <p className="mt-2 text-body">
              {times(shareRate.vsAverage) && (
                <Badge variant="blue" size="sm" className="me-2">
                  {times(shareRate.vsAverage)}
                </Badge>
              )}
              <span className="text-caption text-muted">{t("shareability.averageOf", { average: pct(shareRate.averagePct), posts: shareRate.basedOn })}</span>
            </p>
          ) : (
            <p className="mt-2 text-caption text-muted">{t("shareability.noAverageYet", { count: SHARE_MIN_POSTS })}</p>
          )}
        </>
      ) : (
        <>
          <p className="text-body font-semibold">{t(status === "low_reach" ? "shareability.lowReachTitle" : "shareability.notYet")}</p>
          <p className="mt-0.5 text-caption text-muted">
            {status === "low_reach" ? t("shareability.lowReachHint", { minReach: formatNumber(SHARE_MIN_REACH, locale) }) : t("shareability.unavailableHint")}
          </p>
        </>
      )}
    </Card>
  );
}
