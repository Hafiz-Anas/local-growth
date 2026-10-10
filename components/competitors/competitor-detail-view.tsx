"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ExternalLink, Heart, MapPin, MessageCircle, Sparkles, UserX } from "lucide-react";
import { useActiveClient } from "@/components/providers/active-client-provider";
import { Avatar } from "@/components/shared/avatar";
import { ChangeIndicator } from "@/components/shared/change-indicator";
import { MediaPlaceholder } from "@/components/shared/media";
import { SectionTitle } from "@/components/shared/page-header";
import { EmptyState, ErrorState, Skeleton } from "@/components/shared/states";
import { VerifiedBadge } from "@/components/shared/verified-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiClientError } from "@/lib/api/client";
import { useCompetitor } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { cn, formatCompact, formatPct, initials, toneFor } from "@/lib/utils";
import type { CompetitorDto, CompetitorPost } from "@/types";
import { CompetitorDialog } from "./competitor-dialog";
import { CompetitorMenu } from "./competitor-menu";
import { EngagementChart } from "./engagement-chart";
import { bestPost, competitorName } from "./helpers";
import { RemoveCompetitorDialog } from "./remove-competitor-dialog";

/**
 * One competitor: header, top post, engagement over time and recent posts.
 * Sections are self-contained cards so more can be added later.
 */
export function CompetitorDetailView({ id }: { id: string }) {
  const { t } = useI18n();
  const query = useCompetitor(id);

  return (
    <div>
      <BackLink />
      {query.isPending ? (
        <DetailSkeleton />
      ) : query.isError && !(query.error instanceof ApiClientError && query.error.status === 404) ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : !query.data ? (
        <EmptyState
          icon={UserX}
          title={t("competitors.detail.goneTitle")}
          hint={t("competitors.detail.goneHint")}
          className="rounded-panel border border-border"
          action={
            <Button variant="secondary" asChild>
              <Link href="/competitors">{t("competitors.detail.back")}</Link>
            </Button>
          }
        />
      ) : (
        <Detail competitor={query.data} />
      )}
    </div>
  );
}

function BackLink() {
  const { t } = useI18n();
  return (
    <Link href="/competitors" className="mb-4 inline-flex items-center gap-1 text-body font-semibold text-muted hover:text-foreground">
      <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" />
      {t("competitors.detail.back")}
    </Link>
  );
}

function Detail({ competitor: c }: { competitor: CompetitorDto }) {
  const { t, locale } = useI18n();
  const { isPreview } = useActiveClient();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState<CompetitorDto | null>(null);
  const name = competitorName(c);
  const top = bestPost(c);

  return (
    <>
      {/* Header — Instagram profile style */}
      <section className="mb-6 rounded-panel border border-border p-4 md:p-6">
        <div className="flex items-start gap-4 md:gap-8">
          <Avatar src={c.avatarUrl} alt={c.handle} initials={initials(name)} tone={toneFor(c.handle)} size="xl" ring="story" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h1 className="flex items-center gap-1.5 text-heading font-bold">
                  <span className="truncate" dir="auto">
                    {name}
                  </span>
                  {c.verified && <VerifiedBadge label={t("common.verified")} />}
                </h1>
                <p className="truncate text-body text-muted" dir="ltr">
                  <bdi>@{c.handle}</bdi>
                </p>
              </div>
              {!isPreview && <CompetitorMenu name={name} onEdit={() => setEditing(true)} onRemove={() => setRemoving(c)} />}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {c.note && (
                <span className="rounded-pill bg-button-secondary px-2.5 py-0.5 text-caption font-semibold" dir="auto">
                  {c.note}
                </span>
              )}
              {c.location && (
                <span className="inline-flex items-center gap-1 text-caption text-muted">
                  <MapPin className="size-3" aria-hidden="true" />
                  {c.location}
                </span>
              )}
            </div>

            <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
              <Stat label={t("competitors.card.followers")} value={formatCompact(c.followers, locale)} extra={<ChangeIndicator value={c.followerChangePct} />} />
              <Stat label={t("competitors.card.engagement")} value={formatPct(c.engagementRate)} />
              <Stat label={t("competitors.detail.postsPerWeek")} value={String(c.postsPerWeek)} />
            </dl>

            <Button variant="secondary" size="sm" className="mt-4" asChild>
              <a href={`https://instagram.com/${c.handle}`} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5" />
                {t("dashboard.viewOnInstagram")}
              </a>
            </Button>
          </div>
        </div>
      </section>

      <div className="mb-6 grid gap-6 lg:grid-cols-[340px_1fr]">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>{t("competitors.detail.topPost")}</CardTitle>
            {top?.notable && (
              <Badge variant="gradient" size="sm">
                <Sparkles />
                {t("competitors.card.spike")}
              </Badge>
            )}
          </CardHeader>
          {top ? (
            <>
              <PostTile post={top} large />
              {c.notableNote && (
                <CardContent className="pt-3">
                  <p className="flex items-start gap-1.5 text-body">
                    <Sparkles className="mt-0.5 size-4 shrink-0 text-ig-pink" aria-hidden="true" />
                    <bdi>{c.notableNote}</bdi>
                  </p>
                </CardContent>
              )}
            </>
          ) : (
            <p className="px-4 pb-6 text-body text-muted">{t("competitors.card.noPosts")}</p>
          )}
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>{t("competitors.detail.engagement")}</CardTitle>
              <CardDescription>{t("competitors.detail.engagementHint")}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {c.engagementHistory.length > 1 ? (
              <EngagementChart data={c.engagementHistory} />
            ) : (
              <p className="py-12 text-center text-body text-muted">{t("states.noChartData")}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {c.recentPosts.length > 0 && (
        <section>
          <SectionTitle>{t("competitors.detail.recentPosts")}</SectionTitle>
          <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {c.recentPosts.map((post) => (
              <li key={post.id}>
                <PostTile post={post} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <CompetitorDialog open={editing} competitor={c} onOpenChange={setEditing} />
      <RemoveCompetitorDialog competitor={removing} onOpenChange={(open) => !open && setRemoving(null)} onRemoved={() => router.push("/competitors")} />
    </>
  );
}

/** Post thumbnail with likes and comments always visible (not hover-only). */
function PostTile({ post, large = false }: { post: CompetitorPost; large?: boolean }) {
  const { t, locale } = useI18n();
  return (
    <MediaPlaceholder tone={post.tone} icon={post.icon} src={post.mediaUrl} className={cn("w-full", large ? "aspect-[4/3]" : "aspect-square")} iconClassName={large ? "size-1/4" : "size-1/3"}>
      {post.notable && !large && (
        <Badge variant="gradient" size="sm" className="absolute start-1.5 top-1.5">
          <Sparkles />
          {t("competitors.notable")}
        </Badge>
      )}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 flex gap-3 bg-gradient-to-t from-black/65 to-transparent font-semibold text-white",
          large ? "px-3 pt-10 pb-3 text-title" : "px-2 pt-6 pb-1.5 text-caption",
        )}
      >
        <span className="flex items-center gap-1">
          <Heart className={cn("fill-white", large ? "size-5" : "size-3.5")} aria-hidden="true" />
          <span className="sr-only">{t("common.likes", { count: post.likes })}</span>
          <span aria-hidden="true">{formatCompact(post.likes, locale)}</span>
        </span>
        <span className="flex items-center gap-1">
          <MessageCircle className={cn("fill-white rtl:-scale-x-100", large ? "size-5" : "size-3.5")} aria-hidden="true" />
          <span className="sr-only">{t("common.comments", { count: post.comments })}</span>
          <span aria-hidden="true">{formatCompact(post.comments, locale)}</span>
        </span>
      </div>
    </MediaPlaceholder>
  );
}

function Stat({ label, value, extra }: { label: string; value: string; extra?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="flex items-baseline gap-1.5">
        <span className="text-heading font-bold tabular-nums">{value}</span>
        {extra}
      </dd>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true">
      <div className="mb-6 flex items-start gap-6 rounded-panel border border-border p-6">
        <Skeleton className="size-[77px] shrink-0 rounded-pill md:size-[150px]" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
          <div className="flex gap-8 pt-2">
            <Skeleton className="h-10 w-20" />
            <Skeleton className="h-10 w-20" />
            <Skeleton className="h-10 w-20" />
          </div>
        </div>
      </div>
      <div className="mb-6 grid gap-6 lg:grid-cols-[340px_1fr]">
        <Skeleton className="h-72 rounded-panel" />
        <Skeleton className="h-72 rounded-panel" />
      </div>
      <div className="grid grid-cols-3 gap-1">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="aspect-square rounded-none" />
        ))}
      </div>
    </div>
  );
}
