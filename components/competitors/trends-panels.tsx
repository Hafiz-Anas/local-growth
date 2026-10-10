"use client";

import { Hash, Music2, Search } from "lucide-react";
import { useActiveClient, useFeature } from "@/components/providers/active-client-provider";
import { ChangeIndicator } from "@/components/shared/change-indicator";
import { ErrorState, SkeletonCard } from "@/components/shared/states";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTrends } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { cn, formatCompact } from "@/lib/utils";

/** Trending audio and hashtags/keywords — each panel only when its feature is on. */
export function TrendsPanels() {
  const { t } = useI18n();
  const { client } = useActiveClient();
  const showAudio = useFeature("competitors.trendingAudio");
  const showTags = useFeature("competitors.trendingHashtags");
  const trends = useTrends(showAudio || showTags);

  if (!showAudio && !showTags) return null;
  if (trends.isPending) {
    return (
      <div className={cn("grid gap-6", showAudio && showTags && "lg:grid-cols-2")}>
        {showAudio && <SkeletonCard lines={5} />}
        {showTags && <SkeletonCard lines={5} />}
      </div>
    );
  }
  if (trends.isError) return <ErrorState error={trends.error} onRetry={() => trends.refetch()} />;

  const { audio, tags } = trends.data;
  return (
    <div className={cn("grid gap-6", audio && tags && "lg:grid-cols-2")}>
      {client.instagramProvider === "meta" && <p className="rounded-card bg-secondary-bg px-3 py-2 text-caption text-muted lg:col-span-2">{t("instagramConnect.notes.trends")}</p>}
      {audio && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t("competitors.trendingAudio")}</CardTitle>
              <CardDescription>{t("competitors.audioHint")}</CardDescription>
            </div>
          </CardHeader>
          {audio.length === 0 ? (
            <p className="px-4 pb-6 text-body text-muted">{t("competitors.noTrends")}</p>
          ) : (
            <ul className="pb-2">
              {audio.map((item, i) => (
                <li key={item.id} className="flex items-center gap-3 px-4 py-2">
                  <span className="w-4 text-center text-caption font-semibold text-muted tabular-nums">{i + 1}</span>
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-button bg-ig-gradient text-white">
                    <Music2 className="size-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-semibold">{item.title}</p>
                    <p className="truncate text-caption text-muted">
                      {item.artist} · {t("competitors.reels", { count: formatCompact(item.reelsCount) })}
                    </p>
                  </div>
                  <ChangeIndicator value={item.growthPct} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tags && (
        <Card>
          <CardHeader>
            <CardTitle>{t("competitors.trendingTags")}</CardTitle>
          </CardHeader>
          {tags.length === 0 ? (
            <p className="px-4 pb-6 text-body text-muted">{t("competitors.noTrends")}</p>
          ) : (
            <ul className="pb-2">
              {tags.map((tag) => (
                <li key={tag.id} className="flex items-center gap-3 px-4 py-2">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-pill border border-border">
                    {tag.kind === "hashtag" ? <Hash className="size-5" aria-hidden="true" /> : <Search className="size-5" aria-hidden="true" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-semibold">
                      <bdi>{tag.tag}</bdi>
                    </p>
                    <p className="truncate text-caption text-muted">
                      {tag.kind === "hashtag" ? t("competitors.hashtag") : t("competitors.keyword")} ·{" "}
                      {t("competitors.postsCount", { count: formatCompact(tag.postsCount) })}
                    </p>
                  </div>
                  <ChangeIndicator value={tag.growthPct} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
