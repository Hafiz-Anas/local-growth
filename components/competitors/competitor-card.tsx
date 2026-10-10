"use client";

import Link from "next/link";
import { Heart, MessageCircle, Sparkles } from "lucide-react";
import { Avatar } from "@/components/shared/avatar";
import { ChangeIndicator } from "@/components/shared/change-indicator";
import { MediaPlaceholder } from "@/components/shared/media";
import { Skeleton } from "@/components/shared/states";
import { VerifiedBadge } from "@/components/shared/verified-badge";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n/provider";
import { formatCompact, formatPct, initials, toneFor } from "@/lib/utils";
import type { CompetitorDto } from "@/types";
import { CompetitorMenu } from "./competitor-menu";
import { bestPost, competitorName } from "./helpers";

/**
 * Grid card: identity, note, their best recent post, and the two numbers that
 * matter. The whole card links to the detail view (a stretched link under the
 * content); the three-dot menu sits above it so it never triggers navigation.
 */
export function CompetitorCard({
  competitor: c,
  onEdit,
  onRemove,
}: {
  competitor: CompetitorDto;
  /** Omitted in read-only contexts (admin preview): no menu. */
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  const { t, locale } = useI18n();
  const name = competitorName(c);
  const top = bestPost(c);
  const spike = Boolean(top?.notable);

  return (
    <article className="group relative flex flex-col rounded-panel border border-border bg-background transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-menu focus-within:shadow-menu motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <header className="flex items-center gap-3 p-4 pb-3">
        <Avatar src={c.avatarUrl} initials={initials(name)} tone={toneFor(c.handle)} size="md" ring="story" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-body font-semibold">
            <span className="truncate" dir="auto">
              {name}
            </span>
            {c.verified && <VerifiedBadge label={t("common.verified")} />}
          </p>
          <p className="truncate text-caption text-muted" dir="ltr">
            <bdi>@{c.handle}</bdi>
          </p>
        </div>
        {onEdit && onRemove && <CompetitorMenu name={name} onEdit={onEdit} onRemove={onRemove} />}
      </header>

      {c.note && (
        <p className="mx-4 mb-3 w-fit max-w-[calc(100%-2rem)] truncate rounded-pill bg-button-secondary px-2.5 py-0.5 text-caption font-semibold" dir="auto">
          {c.note}
        </p>
      )}

      <div className="mx-4 overflow-hidden rounded-card">
        {top ? (
          <MediaPlaceholder tone={top.tone} icon={top.icon} src={top.mediaUrl} className="aspect-[4/3] w-full" iconClassName="size-1/4">
            {spike && (
              <Badge variant="gradient" size="sm" className="absolute start-2 top-2">
                <Sparkles />
                {t("competitors.card.spike")}
              </Badge>
            )}
            <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/65 to-transparent px-3 pt-8 pb-2.5 text-body font-semibold text-white">
              <span className="flex items-center gap-1" title={t("common.likes", { count: top.likes })}>
                <Heart className="size-4 fill-white" aria-hidden="true" />
                {formatCompact(top.likes, locale)}
              </span>
              <span className="flex items-center gap-1">
                <MessageCircle className="size-4 fill-white rtl:-scale-x-100" aria-hidden="true" />
                {formatCompact(top.comments, locale)}
              </span>
              <span className="ms-auto text-caption font-semibold text-white/85">{t("competitors.card.topPost")}</span>
            </div>
          </MediaPlaceholder>
        ) : (
          <div className="flex aspect-[4/3] items-center justify-center bg-secondary-bg text-caption text-muted">{t("competitors.card.noPosts")}</div>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-2 p-4">
        <div>
          <dt className="text-caption text-muted">{t("competitors.card.followers")}</dt>
          <dd className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="text-title font-bold tabular-nums">{formatCompact(c.followers, locale)}</span>
            <ChangeIndicator value={c.followerChangePct} />
          </dd>
        </div>
        <div>
          <dt className="text-caption text-muted">{t("competitors.card.engagement")}</dt>
          <dd className="text-title font-bold tabular-nums">{formatPct(c.engagementRate)}</dd>
        </div>
      </dl>

      {/* Stretched link: the whole card opens the detail view. */}
      <Link
        href={`/competitors/${c.id}`}
        className="absolute inset-0 rounded-panel outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        aria-label={t("competitors.card.open", { name })}
      />
    </article>
  );
}

export function CompetitorCardSkeleton() {
  return (
    <div aria-hidden="true" className="rounded-panel border border-border">
      <div className="flex items-center gap-3 p-4 pb-3">
        <Skeleton className="size-11 rounded-pill" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <Skeleton className="mx-4 aspect-[4/3] rounded-card" />
      <div className="grid grid-cols-2 gap-2 p-4">
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
      </div>
    </div>
  );
}
