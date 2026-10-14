"use client";

import Link from "next/link";
import { CalendarClock, Heart, MessageCircle, MessagesSquare, Bookmark, Eye, ShieldCheck } from "lucide-react";
import { useActiveClient } from "@/components/providers/active-client-provider";
import { Feature } from "@/components/shared/feature-gate";
import { MediaPlaceholder } from "@/components/shared/media";
import { MetricCard } from "@/components/shared/metric-card";
import { CaptionText } from "@/components/shared/post-preview";
import { SectionTitle } from "@/components/shared/page-header";
import { StatTile } from "@/components/shared/stat-tile";
import { ErrorState, Skeleton, SkeletonCard } from "@/components/shared/states";
import { TimeAgo } from "@/components/shared/time-ago";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/provider";
import { formatCompact, formatNumber, formatPct } from "@/lib/utils";
import { useDashboard } from "@/lib/api/queries";
import { AiStatusCard } from "./ai-status-card";
import { SetupPrompts } from "./setup-prompts";
import { FollowerChart } from "./follower-chart";
import { ConnectInstagramReminder, WelcomeCard } from "./onboarding-cards";
import type { MetricValue } from "@/types";
import { ProfileHeader } from "./profile-header";

export function DashboardView({ welcome = false }: { welcome?: boolean }) {
  const { client } = useActiveClient();
  const { t, locale } = useI18n();
  const query = useDashboard();

  const intro = (
    <>
      {welcome && <WelcomeCard />}
      <SetupPrompts />
      <ConnectInstagramReminder />
    </>
  );
  if (query.isPending) return <DashboardSkeleton />;
  if (query.isError)
    return (
      <>
        {intro}
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </>
    );

  // The API only returns sections whose features are ON.
  const { metrics, followerSeries, topPost, quickTiles = {} } = query.data;
  const showChart = Boolean(followerSeries);
  const showTopPost = Boolean(topPost);
  /** Metrics Instagram has no data for yet (small or new accounts connected through Meta). */
  const na = (m: MetricValue) => (m.available === false ? t("dashboard.notAvailable") : undefined);
  // Quick tiles depend on other modules: a tile disappears when its module is off.
  const showComments = quickTiles.commentsHandledToday !== undefined;
  const showAwaiting = quickTiles.repliesAwaitingApproval !== undefined;
  const nextWindow = quickTiles.nextWindow;
  const showWindow = Boolean(nextWindow);
  const anyTile = showComments || showAwaiting || showWindow;

  return (
    <div>
      {intro}
      <Feature flag="dashboard.profileHeader">
        <ProfileHeader client={client} />
      </Feature>
      <AiStatusCard />

      {metrics && (
        <>
        <SectionTitle action={<span className="text-caption text-muted">{t("dashboard.last30")}</span>}>
          {t("dashboard.title")}
        </SectionTitle>
        <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard label={t("dashboard.metrics.reach")} value={formatCompact(metrics.reach.value, locale)} changePct={metrics.reach.changePct} unavailable={na(metrics.reach)} />
          <MetricCard label={t("dashboard.metrics.engagementRate")} value={formatPct(metrics.engagementRate.value)} changePct={metrics.engagementRate.changePct} unavailable={na(metrics.engagementRate)} />
          <MetricCard
            label={t("dashboard.metrics.followerGrowth")}
            value={`${metrics.followerGrowth.value < 0 ? "" : "+"}${formatNumber(metrics.followerGrowth.value, locale)}`}
            changePct={metrics.followerGrowth.changePct}
            unavailable={na(metrics.followerGrowth)}
          />
          <MetricCard label={t("dashboard.metrics.profileVisits")} value={formatNumber(metrics.profileVisits.value, locale)} changePct={metrics.profileVisits.changePct} unavailable={na(metrics.profileVisits)} />
        </div>
        </>
      )}

      {(showChart || showTopPost) && (
        <div className="grid items-start gap-4 lg:grid-cols-3">
          {showChart && (
            <Card className={showTopPost ? "lg:col-span-2" : "lg:col-span-3"}>
              <CardHeader>
                <div>
                  <CardTitle>{t("dashboard.followerChart")}</CardTitle>
                  <CardDescription>{t("dashboard.followerChartHint")}</CardDescription>
                </div>
                <p className="text-end">
                  <span className="block text-heading font-bold tabular-nums">{formatNumber(client.followers, locale)}</span>
                  <span className="text-caption text-muted">{t("common.followers")}</span>
                </p>
              </CardHeader>
              <CardContent>
                {followerSeries!.length > 0 ? (
                  <FollowerChart data={followerSeries!} />
                ) : (
                  <p className="py-12 text-center text-body text-muted">{t("states.noChartData")}</p>
                )}
              </CardContent>
            </Card>
          )}

          {showTopPost && topPost && (
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>{t("dashboard.topPost")}</CardTitle>
                <TimeAgo iso={topPost.postedAt} className="text-caption text-muted" />
              </CardHeader>
              {/* Real posts (Meta) show their image; mock posts keep the placeholder artwork. */}
              <MediaPlaceholder tone={topPost.tone} icon={topPost.icon} src={topPost.mediaUrl?.startsWith("https://") ? topPost.mediaUrl : null} className="aspect-[4/3] w-full">
                <div className="absolute inset-x-0 bottom-0 flex gap-4 bg-gradient-to-t from-black/60 to-transparent px-3 pt-8 pb-2.5 text-body font-semibold text-white">
                  <span className="flex items-center gap-1">
                    <Heart className="size-4 fill-white" /> {formatCompact(topPost.likes, locale)}
                  </span>
                  <span className="flex items-center gap-1">
                    <MessageCircle className="size-4 fill-white rtl:-scale-x-100" /> {formatCompact(topPost.comments, locale)}
                  </span>
                </div>
              </MediaPlaceholder>
              <CardContent className="pt-3">
                <p className="line-clamp-2 text-body" dir="auto">
                  <span className="me-1 font-semibold">{client.handle}</span>
                  <CaptionText text={topPost.caption} />
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-2">
                  <MiniStat icon={Eye} label={t("common.reach")} value={formatCompact(topPost.reach, locale)} />
                  <MiniStat icon={Bookmark} label={t("common.saves")} value={formatCompact(topPost.saves, locale)} />
                </dl>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {anyTile && (
        <Feature flag="dashboard.quickTiles">
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {showComments && (
              <StatTile icon={MessagesSquare} label={t("dashboard.tiles.commentsHandled")} value={formatNumber(quickTiles.commentsHandledToday ?? 0, locale)} />
            )}
            {showAwaiting && (
              <StatTile
                icon={ShieldCheck}
                label={t("dashboard.tiles.awaiting")}
                value={quickTiles.repliesAwaitingApproval ?? 0}
                accent={(quickTiles.repliesAwaitingApproval ?? 0) > 0}
                action={
                  <Button variant="link" asChild>
                    <Link href="/engagement">{t("dashboard.tiles.review")}</Link>
                  </Button>
                }
              />
            )}
            {nextWindow && (
              <StatTile
                icon={CalendarClock}
                label={`${t("dashboard.tiles.nextWindow")} · ${t(`windows.${nextWindow.window}`)}`}
                value={
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span dir="ltr">
                      {nextWindow.start}–{nextWindow.end}
                    </span>
                    <span className="text-caption font-semibold text-success">
                      {t("dashboard.tiles.lift", { lift: formatPct(nextWindow.liftPct, { signed: true }) })}
                    </span>
                  </span>
                }
              />
            )}
          </div>
        </Feature>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true">
      <div className="mb-8 flex items-center gap-6 border-b border-border pb-8 md:gap-20 md:px-8">
        <Skeleton className="size-[77px] shrink-0 rounded-pill md:size-[150px]" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64 max-w-full" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[92px] rounded-panel" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <SkeletonCard lines={6} className="lg:col-span-2" />
        <SkeletonCard media lines={2} />
      </div>
    </div>
  );
}

function MiniStat({ icon: Icon, label, value }: { icon: typeof Eye; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-button bg-secondary-bg px-2.5 py-2">
      <Icon className="size-4 text-muted" aria-hidden="true" />
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="ms-auto text-body font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
