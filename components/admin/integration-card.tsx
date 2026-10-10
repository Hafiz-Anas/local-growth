"use client";

import { useState } from "react";
import { Camera } from "lucide-react";
import { ErrorState, Skeleton } from "@/components/shared/states";
import { TimeAgo } from "@/components/shared/time-ago";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAdminIntegration } from "@/lib/api/admin";
import { useI18n } from "@/lib/i18n/provider";
import { cn, formatDateTime } from "@/lib/utils";
import type { AdminIntegrationDto, IntegrationEventDto } from "@/types";

/** Admin client page: Instagram connection (provider, status, token expiry, permissions) and the Meta integration log. */
export function IntegrationCard({ businessId }: { businessId: string }) {
  const { t, locale } = useI18n();
  const query = useAdminIntegration(businessId);

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Camera className="size-5" aria-hidden="true" />
            {t("admin.integration.title")}
          </CardTitle>
          <CardDescription>{t("admin.integration.hint")}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {query.isPending && <Skeleton className="h-24 w-full" />}
        {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
        {query.data && (
          <>
            <ConnectionDetails connection={query.data.connection} locale={locale} />
            <h3 className="mt-5 mb-2 text-body font-semibold">{t("admin.integration.log")}</h3>
            <IntegrationLog events={query.data.events} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

const STATUS_VARIANT: Record<AdminIntegrationDto["connection"]["status"], "success" | "warning" | "danger" | "neutral"> = {
  connected: "success",
  needs_reconnect: "danger",
  expired: "warning",
  disconnected: "neutral",
};

function ConnectionDetails({ connection: c, locale }: { connection: AdminIntegrationDto["connection"]; locale: "en" | "ar" }) {
  const { t } = useI18n();
  const date = (iso: string | null) => (iso ? formatDateTime(iso, locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : t("admin.integration.none"));
  const rows: Array<[string, React.ReactNode]> = [
    [t("admin.integration.provider"), c.provider ? t(`admin.integration.providers.${c.provider}`) : t("admin.integration.none")],
    [t("admin.integration.account"), c.username ? <bdi dir="ltr">@{c.username}</bdi> : t("admin.integration.none")],
    ...(c.pageName ? ([[t("admin.integration.page"), <bdi key="page">{c.pageName}</bdi>]] as Array<[string, React.ReactNode]>) : []),
    [t("admin.integration.connectedAt"), date(c.connectedAt)],
    [t("admin.integration.tokenExpires"), <span key="exp" className={cn(c.tokenExpiresSoon && "font-semibold text-warning")}>{c.tokenExpiresAt ? date(c.tokenExpiresAt) : c.provider === "meta" && c.status !== "disconnected" ? t("admin.integration.neverExpires") : t("admin.integration.none")}</span>],
    ...(c.provider === "meta" ? ([[t("admin.integration.dataAccessExpires"), date(c.dataAccessExpiresAt)]] as Array<[string, React.ReactNode]>) : []),
    [t("admin.integration.lastSync"), c.lastSyncAt ? <TimeAgo key="sync" iso={c.lastSyncAt} /> : t("admin.integration.none")],
    ...(c.lastSyncError ? ([[t("admin.integration.lastSyncError"), <span key="err" className="text-danger">{t(`instagramConnect.sync.errors.${c.lastSyncError}`)}</span>]] as Array<[string, React.ReactNode]>) : []),
  ];
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge variant={STATUS_VARIANT[c.status]}>{t(`admin.integration.status.${c.status}`)}</Badge>
        {c.missingPermissions.length > 0 && <Badge variant="warning">{t("admin.integration.missingCount", { count: c.missingPermissions.length })}</Badge>}
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-caption sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex min-w-0 justify-between gap-3 border-b border-separator pb-1.5">
            <dt className="text-muted">{label}</dt>
            <dd className="min-w-0 truncate text-end">{value}</dd>
          </div>
        ))}
      </dl>
      {c.provider === "meta" && (
        <div className="mt-3 text-caption">
          <p className="text-muted">{t("admin.integration.scopes")}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {c.scopes.map((s) => (
              <Badge key={s} variant="neutral" size="sm">
                {s}
              </Badge>
            ))}
            {c.missingPermissions.map((s) => (
              <Badge key={`missing-${s}`} variant="danger" size="sm" title={t("admin.integration.notGranted")}>
                {s} ✕
              </Badge>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

const LEVEL_CLASS: Record<IntegrationEventDto["level"], string> = { error: "text-danger", warning: "text-warning", info: "text-muted" };

/** Newest first; long logs fold after 8 rows. Used on the client page and the Onboarding page. */
export function IntegrationLog({ events, compact = false }: { events: IntegrationEventDto[]; compact?: boolean }) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  if (!events.length) return <p className="text-caption text-muted">{t("admin.integration.noEvents")}</p>;
  const shown = all ? events : events.slice(0, compact ? 5 : 8);
  return (
    <div>
      <ul className="divide-y divide-separator text-caption">
        {shown.map((e) => (
          <li key={e.id} className="py-2">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className={cn("font-semibold uppercase", LEVEL_CLASS[e.level])}>{t(`admin.integration.levels.${e.level}`)}</span>
              <code className="min-w-0 truncate" dir="ltr">
                {e.call}
              </code>
              {e.errorCode && (
                <code className="rounded-pill bg-secondary-bg px-1.5" dir="ltr">
                  {e.errorCode}
                </code>
              )}
              <TimeAgo iso={e.createdAt} className="ms-auto text-muted" />
            </div>
            <p className="mt-0.5 break-words text-muted" dir="auto">
              {e.message}
            </p>
          </li>
        ))}
      </ul>
      {events.length > shown.length && (
        <Button variant="link" size="sm" className="mt-1" onClick={() => setAll(true)}>
          {t("admin.integration.showAll", { count: events.length })}
        </Button>
      )}
    </div>
  );
}
