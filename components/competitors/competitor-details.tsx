"use client";

import Link from "next/link";
import { Bookmark, ChevronRight, Heart, Sparkles } from "lucide-react";
import { useOpenAi } from "@/components/ai-chat/use-open-ai";
import { useActiveClient, useFeature } from "@/components/providers/active-client-provider";
import { ChangeIndicator } from "@/components/shared/change-indicator";
import { MediaPlaceholder } from "@/components/shared/media";
import { Button } from "@/components/ui/button";
import { competitorSummary, type CompetitorSummary, type Observation, type SummaryFormat } from "@/lib/analysis/competitor-summary";
import { competitorPostRefs } from "@/lib/gallery/competitor-posts";
import { daysPhrase } from "@/lib/i18n/days";
import { useStore } from "@/lib/gallery/store";
import { useI18n } from "@/lib/i18n/provider";
import { cn, formatCompact, formatNumber, intlLocale } from "@/lib/utils";
import { notify } from "@/store/ui-store";
import type { CompetitorDto } from "@/types";

/**
 * A competitor card's expanded part (Competitors → Accounts, UX4): follower growth, posts per week,
 * format mix and one or two observations — all computed in code from stored data
 * (lib/analysis/competitor-summary.ts), each with its period — then their top recent posts (they
 * open in the Gallery's viewer), "Save as inspiration" and "Create a similar post" for their top
 * post, and the link to the full analysis (the detail page).
 */
export function CompetitorDetails({ competitor: c, id }: { competitor: CompetitorDto; id: string }) {
  const { t, locale } = useI18n();
  const { isPreview } = useActiveClient();
  const canSave = useFeature("competitors.inspiration") && !isPreview;
  const canCreate = useFeature("aiChat") && !isPreview;
  const openAi = useOpenAi();
  // The period is counted from now; computed once per render of an open card (never on the server).
  const summary = competitorSummary(c.recentPosts, new Date().getTime());
  const refs = competitorPostRefs(c);
  const top = summary.top.map((postId) => refs.find((r) => r.post.id === postId)).filter((r) => r !== undefined);
  const best = top[0];
  const saved = useStore((s) => (best ? s.inspiration.some((p) => p.key === best.key) : false));
  const num = (n: number) => new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 1 }).format(n);

  const toggleSave = () => {
    if (!best) return;
    const now = useStore.getState().toggleInspiration(best);
    notify.success(t(now ? "competitors.card.savedToast" : "competitors.card.removedToast"));
  };

  return (
    <div id={id} className="relative z-10 space-y-4 border-t border-border bg-background px-4 pt-4 pb-4" data-testid="competitor-details">
      {/* Phones: one tile per row. A wide card: growth and posts per week side by side, the formats full width. */}
      <dl className="grid grid-cols-1 gap-3 @sm:grid-cols-2">
        <div className="rounded-card bg-secondary-bg p-3" data-testid="details-growth">
          <dt className="flex items-baseline justify-between gap-2 text-caption text-muted">
            <span className="font-semibold text-foreground">{t("competitors.card.growth")}</span>
            <span>{t("competitors.card.lastDays", { period: daysPhrase(c.growth?.days ?? 30, locale) })}</span>
          </dt>
          <dd className="mt-1 text-body">
            {c.growth ? (
              <span className="flex flex-wrap items-baseline gap-x-2">
                <ChangeIndicator value={c.growth.changePct} className="text-title" />
                <span className="text-muted">
                  {t("competitors.card.growthValue", { change: `${c.growth.change > 0 ? "+" : ""}${formatNumber(c.growth.change, locale)}`, period: daysPhrase(c.growth.days, locale) })}
                </span>
              </span>
            ) : (
              <span className="text-muted">{t("competitors.card.growthNone")}</span>
            )}
          </dd>
        </div>

        {summary.enough ? (
          <>
            <div className="rounded-card bg-secondary-bg p-3" data-testid="details-frequency">
              <dt className="text-caption font-semibold">{t("competitors.card.postsPerWeek")}</dt>
              <dd>
                <span className="text-title font-bold tabular-nums">{num(summary.postsPerWeek ?? 0)}</span>
                <span className="block text-caption text-muted">{t("competitors.card.postsIn", { count: summary.posts, period: daysPhrase(summary.days, locale) })}</span>
              </dd>
            </div>
            <div className="rounded-card bg-secondary-bg p-3 @sm:col-span-2" data-testid="details-formats">
              <dt className="text-caption font-semibold">{t("competitors.card.formats")}</dt>
              <dd className="mt-1.5 space-y-2">
                <FormatBar summary={summary} />
                <ul className="flex flex-wrap gap-x-4 gap-y-1 text-caption">
                  {summary.formats.map((f) => (
                    <li key={f.format} className="flex items-center gap-1.5">
                      <span className={cn("size-2 shrink-0 rounded-pill", BAR_TONE[f.format])} aria-hidden="true" />
                      <span>{t(`competitors.card.format.${f.format}`)}</span>
                      <span className="font-semibold tabular-nums">{num(f.sharePct)}%</span>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          </>
        ) : (
          <p className="rounded-card bg-secondary-bg p-3 text-caption text-muted @sm:col-span-2" data-testid="details-not-enough">
            {t("competitors.card.notEnough", { count: summary.posts, period: daysPhrase(summary.days, locale) })}
          </p>
        )}
      </dl>

      {summary.enough && (
        <section aria-labelledby={`${id}-obs`} data-testid="details-observations">
          <h3 id={`${id}-obs`} className="mb-1.5 flex items-center gap-1.5 text-caption font-semibold">
            <Sparkles className="size-3.5 text-ig-pink" aria-hidden="true" />
            {t("competitors.card.observations")}
          </h3>
          <ul className="space-y-1 text-body">
            {summary.observations.length ? (
              summary.observations.map((o, i) => <li key={i}>{observationText(o, t, num)}</li>)
            ) : (
              <li className="text-muted">{t("competitors.card.obs.none")}</li>
            )}
          </ul>
          <p className="mt-1 text-caption text-muted">
            {t("competitors.card.measured")} · {t("competitors.card.lastDays", { period: daysPhrase(summary.days, locale) })}
          </p>
        </section>
      )}

      {top.length > 0 && (
        <section aria-labelledby={`${id}-top`}>
          <h3 id={`${id}-top`} className="mb-1.5 text-caption font-semibold">
            {t("competitors.card.topPosts")}
          </h3>
          <ul className="grid grid-cols-3 gap-1 @sm:gap-2" data-testid="details-top-posts">
            {top.map((ref, i) => (
              <li key={ref.key}>
                <button
                  type="button"
                  data-testid="details-top-post"
                  onClick={() => useStore.getState().openCompetitorViewer(refs, refs.indexOf(ref))}
                  className="block w-full overflow-hidden rounded-button focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  aria-label={t("competitors.card.openPost", { n: i + 1 })}
                >
                  <MediaPlaceholder tone={ref.post.tone} icon={ref.post.icon} src={ref.post.mediaUrl} className="aspect-square w-full" iconClassName="size-1/3">
                    {/* Likes only: the tiles are small; the viewer shows likes and comments. */}
                    <span className="absolute inset-x-0 bottom-0 flex items-center gap-0.5 bg-gradient-to-t from-black/65 to-transparent px-1.5 pt-5 pb-1 text-[11px] font-semibold text-white">
                      <Heart className="size-3 shrink-0 fill-white" aria-hidden="true" />
                      <span className="sr-only">{t("common.likes", { count: ref.post.likes })}</span>
                      <span aria-hidden="true">{formatCompact(ref.post.likes, locale)}</span>
                    </span>
                  </MediaPlaceholder>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {best && (canSave || canCreate) && (
        <div>
          <p className="mb-1.5 text-caption text-muted">{t("competitors.card.forTopPost")}</p>
          {/* Stacked on a narrow card (labels would be cut off), side by side on a wide one. */}
          <div className="grid grid-cols-1 gap-2 @sm:grid-cols-2">
            {canSave && (
              <Button variant="secondary" size="sm" onClick={toggleSave} aria-pressed={saved} data-testid="details-save">
                <Bookmark className={cn("size-4", saved && "fill-current")} />
                {t(saved ? "competitors.card.savedInspiration" : "competitors.card.saveInspiration")}
              </Button>
            )}
            {canCreate && (
              <Button size="sm" onClick={() => openAi(undefined, best)} data-testid="details-similar">
                <Sparkles className="size-4" />
                {t("competitors.card.createSimilar")}
              </Button>
            )}
          </div>
        </div>
      )}

      <Link href={`/competitors/${c.id}`} className="inline-flex items-center gap-0.5 text-body font-semibold text-primary hover:underline">
        {t("competitors.card.viewFull")}
        <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
      </Link>
    </div>
  );
}

const BAR_TONE: Record<SummaryFormat, string> = { reel: "bg-ig-pink", photo: "bg-primary", carousel: "bg-ig-orange", video: "bg-muted" };

function FormatBar({ summary }: { summary: CompetitorSummary }) {
  return (
    <div className="flex h-1.5 overflow-hidden rounded-pill bg-border" aria-hidden="true">
      {summary.formats.map((f) => (
        <span key={f.format} className={BAR_TONE[f.format]} style={{ width: `${f.sharePct}%` }} />
      ))}
    </div>
  );
}

function observationText(o: Observation, t: (key: string, vars?: Record<string, string | number>) => string, num: (n: number) => string): string {
  if (o.kind === "formatLift") return t("competitors.card.obs.formatLift", { best: t(`competitors.card.formatIn.${o.best}`), other: t(`competitors.card.formatIn.${o.other}`), ratio: num(o.ratio) });
  if (o.kind === "standout") return t("competitors.card.obs.standout", { ratio: num(o.ratio) });
  return t("competitors.card.obs.mostly", { share: num(o.sharePct), format: t(`competitors.card.formatIn.${o.format}`) });
}
