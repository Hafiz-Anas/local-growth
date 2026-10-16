"use client";

import Link from "next/link";
import { Camera } from "lucide-react";
import { ErrorState, SkeletonList } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAdminAccounts } from "@/lib/api/admin";
import { useI18n } from "@/lib/i18n/provider";
import { cn, formatNumber } from "@/lib/utils";
import type { ConnectionStatus } from "@/types";

const DOT: Record<ConnectionStatus, string> = { connected: "bg-success", needs_attention: "bg-warning", disconnected: "bg-danger" };

/** Admin client page: every Instagram account the client's logins can switch between, their connection, and the count against the plan's limit. */
export function InstagramAccountsCard({ businessId }: { businessId: string }) {
  const { t, locale } = useI18n();
  const query = useAdminAccounts(businessId);

  return (
    <Card className="mb-6" data-testid="admin-instagram-accounts">
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Camera className="size-5" aria-hidden="true" />
            {t("admin.accounts.title")}
          </CardTitle>
          <CardDescription>{t("admin.accounts.hint")}</CardDescription>
        </div>
        {query.data && (
          <Badge variant={query.data.count >= query.data.limit ? "warning" : "neutral"} data-testid="admin-accounts-count">
            {t("admin.accounts.count", { count: formatNumber(query.data.count, locale), limit: formatNumber(query.data.limit, locale) })}
          </Badge>
        )}
      </CardHeader>
      {query.isPending && <SkeletonList rows={2} />}
      {query.isError && (
        <div className="px-4 pb-4">
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        </div>
      )}
      {query.data && (
        <ul className="divide-y divide-separator px-4 pb-2">
          {query.data.items.map((a) => {
            const settingUp = a.setupInProgress && a.connection === "disconnected";
            return (
              <li key={a.id} className="flex items-center gap-3 py-3" data-testid="admin-account-row">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-semibold">
                    {a.handle ? <bdi dir="ltr">@{a.handle}</bdi> : <span className="text-muted">{t("admin.accounts.notConnected")}</span>}
                  </span>
                  {a.name && a.name !== a.handle && (
                    <span className="block truncate text-caption text-muted">
                      <bdi>{a.name}</bdi>
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-caption text-muted">
                  <span className={cn("size-2 rounded-pill", settingUp ? "bg-muted" : DOT[a.connection])} aria-hidden="true" />
                  {settingUp ? t("admin.accounts.settingUp") : t(`connection.${a.connection}`)}
                </span>
                {a.id === businessId ? (
                  <Badge variant="blue" size="sm">
                    {t("admin.accounts.current")}
                  </Badge>
                ) : (
                  <Link href={`/admin/clients/${a.id}`} className="shrink-0 text-caption font-semibold text-primary hover:text-link">
                    {t("admin.accounts.open")}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
