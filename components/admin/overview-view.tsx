"use client";

import Link from "next/link";
import { MessagesSquare, Plug, Send, ShieldCheck, Store } from "lucide-react";
import { ClientRow } from "@/components/shared/client-row";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, Skeleton, SkeletonList } from "@/components/shared/states";
import { StatTile } from "@/components/shared/stat-tile";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { businessToClient, useAdminBusinesses, useAdminOverview } from "@/lib/api/admin";
import { useI18n } from "@/lib/i18n/provider";
import { formatNumber } from "@/lib/utils";
import { ActivityFeed } from "./activity-feed";

export function OverviewView() {
  const { t, locale } = useI18n();
  const overview = useAdminOverview();
  const businesses = useAdminBusinesses();

  return (
    <div>
      <PageHeader title={t("admin.overview.title")} subtitle={t("admin.overview.subtitle")} />

      {overview.isPending ? (
        <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-[84px] rounded-panel" />
          ))}
        </div>
      ) : overview.isError ? (
        <ErrorState error={overview.error} onRetry={() => overview.refetch()} className="mb-8" />
      ) : (
        <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatTile icon={Store} label={t("admin.overview.activeClients")} value={overview.data.businesses.total} />
          <StatTile icon={Plug} label={t("admin.overview.connectedAccounts")} value={`${overview.data.connections.connected}/${overview.data.businesses.total}`} />
          <StatTile icon={Send} label={t("admin.overview.postsThisWeek")} value={formatNumber(overview.data.postsPublishedThisWeek, locale)} />
          <StatTile icon={MessagesSquare} label={t("admin.overview.commentsHandled")} value={formatNumber(overview.data.commentsHandledThisWeek, locale)} />
          <StatTile
            icon={ShieldCheck}
            label={t("admin.overview.awaiting")}
            value={overview.data.repliesAwaitingApproval}
            accent={overview.data.repliesAwaitingApproval > 0}
            className="col-span-2 lg:col-span-1"
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{t("admin.overview.clients")}</CardTitle>
            <Button variant="link" asChild>
              <Link href="/admin/clients">{t("common.viewAll")}</Link>
            </Button>
          </CardHeader>
          <div className="pb-2">
            {businesses.isPending ? (
              <SkeletonList rows={3} />
            ) : businesses.isError ? (
              <ErrorState error={businesses.error} onRetry={() => businesses.refetch()} className="m-4" />
            ) : businesses.data.length === 0 ? (
              <EmptyState icon={Store} title={t("admin.clients.emptyTitle")} hint={t("admin.clients.emptyHint")} />
            ) : (
              businesses.data.map((b) => <ClientRow key={b.id} client={businessToClient(b)} href={`/admin/clients/${b.id}`} />)
            )}
          </div>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{t("admin.overview.activity")}</CardTitle>
          </CardHeader>
          <ActivityFeed />
        </Card>
      </div>
    </div>
  );
}
