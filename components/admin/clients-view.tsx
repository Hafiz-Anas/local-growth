"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Plus, Search, Store } from "lucide-react";
import { Avatar } from "@/components/shared/avatar";
import { PlanBadge } from "@/components/shared/client-row";
import { ConnectionPill } from "@/components/shared/connection-pill";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, SkeletonList } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PROGRESS_STEPS, stepNumber } from "@/config/onboarding";
import { businessToClient, useAdminBusinesses } from "@/lib/api/admin";
import { useI18n } from "@/lib/i18n/provider";
import type { AdminBusinessDto } from "@/types";
import { NewClientDialog } from "./new-client-dialog";

export function ClientsView() {
  const { t, locale } = useI18n();
  const businesses = useAdminBusinesses();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const q = query.trim().toLowerCase();
  const filtered = (businesses.data ?? []).filter((b) =>
    [b.name, b.nameAr ?? "", b.instagramHandle ?? "", ...b.users.map((u) => u.email)].some((v) => v.toLowerCase().includes(q)),
  );

  return (
    <div>
      <PageHeader
        title={t("admin.clients.title")}
        subtitle={t("admin.clients.subtitle")}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            {t("admin.newClient.open")}
          </Button>
        }
      />

      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("admin.clients.searchPlaceholder")} className="ps-9" aria-label={t("common.search")} />
      </div>

      <div className="overflow-hidden rounded-panel border border-border">
        <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_100px_150px_90px_24px] gap-4 border-b border-border bg-secondary-bg px-4 py-2.5 text-caption font-semibold text-muted md:grid">
          <span>{t("admin.clients.business")}</span>
          <span>{t("admin.clients.email")}</span>
          <span>{t("admin.clients.plan")}</span>
          <span>{t("admin.clients.status")}</span>
          <span>{t("admin.clients.features")}</span>
          <span />
        </div>

        {businesses.isPending && <SkeletonList rows={3} />}
        {businesses.isError && <ErrorState error={businesses.error} onRetry={() => businesses.refetch()} className="m-4" />}
        {businesses.isSuccess && businesses.data.length === 0 && (
          <EmptyState
            icon={Store}
            title={t("admin.clients.emptyTitle")}
            hint={t("admin.clients.emptyHint")}
            action={<Button onClick={() => setCreating(true)}>{t("admin.newClient.open")}</Button>}
          />
        )}
        {businesses.isSuccess && businesses.data.length > 0 && filtered.length === 0 && (
          <p className="px-4 py-10 text-center text-body text-muted">{t("admin.clients.noResults")}</p>
        )}

        <ul className="divide-y divide-separator">
          {filtered.map((b) => {
            const client = businessToClient(b);
            return (
              <li key={b.id}>
                <Link
                  href={`/admin/clients/${b.id}`}
                  className="grid grid-cols-[minmax(0,1fr)_24px] items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-hover md:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_100px_150px_90px_24px]"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <Avatar src={client.avatarUrl} initials={client.avatarInitials} tone={client.avatarTone} size="md" ring={client.connection === "connected" ? "story" : "seen"} />
                    <span className="min-w-0">
                      <span className="block truncate text-body font-semibold">{locale === "ar" ? client.businessNameAr : client.businessName}</span>
                      <span className="block truncate text-body text-muted">{client.instagramHandle ?? t("admin.clients.noHandle")}</span>
                      <OnboardingTags business={b} />
                    </span>
                  </span>
                  <ChevronRight className="size-5 text-muted md:order-last rtl:-scale-x-100" aria-hidden="true" />
                  <span className="col-span-2 truncate text-body text-muted md:col-span-1">
                    <bdi>{client.email || "—"}</bdi>
                  </span>
                  <span className="col-span-2 flex flex-wrap items-center gap-2 md:contents">
                    <span>
                      <PlanBadge plan={client.plan} />
                    </span>
                    <span>
                      <ConnectionPill status={client.connection} />
                    </span>
                    <span className="text-caption font-semibold text-muted tabular-nums">
                      {t("admin.clients.enabledCount", { count: b.enabledFeatures, total: b.totalFeatures })}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <NewClientDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

/** "Self sign-up" and the onboarding status (only shown when there's something to say). */
export function OnboardingTags({ business: b }: { business: AdminBusinessDto }) {
  const { t } = useI18n();
  const inProgress = b.onboardingStatus === "in_progress";
  if (b.source !== "self_signup" && !inProgress) return null;
  const n = Math.min(stepNumber(b.onboardingStep), PROGRESS_STEPS.length);
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {b.source === "self_signup" && (
        <Badge variant="outline" size="sm">
          {t("adminOnboarding.selfSignup")}
        </Badge>
      )}
      {inProgress ? (
        <Badge variant="blue" size="sm">
          {t("adminOnboarding.atStep", { n, total: PROGRESS_STEPS.length, name: t(`onboarding.steps.${b.onboardingStep}.short`) })}
        </Badge>
      ) : (
        <Badge variant="success" size="sm">
          {t("adminOnboarding.onboarded")}
        </Badge>
      )}
    </span>
  );
}
