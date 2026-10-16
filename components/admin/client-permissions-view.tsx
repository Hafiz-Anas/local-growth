"use client";

import { startTransition, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, Eye, Trash2 } from "lucide-react";
import { FEATURE_KEYS, FEATURE_MODULES } from "@/config/features";
import { PLAN_IDS, PLAN_PRESETS } from "@/config/plans";
import { Segmented } from "@/components/settings/segmented";
import { Avatar } from "@/components/shared/avatar";
import { PlanBadge } from "@/components/shared/client-row";
import { ConnectionPill } from "@/components/shared/connection-pill";
import { FeatureToggle } from "@/components/shared/feature-toggle";
import { ErrorState, Skeleton } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { businessToClient, useAdminBusiness, useAdminPermissions } from "@/lib/api/admin";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { qk } from "@/lib/api/queries";
import { startPreviewAction } from "@/lib/auth/actions";
import { useI18n } from "@/lib/i18n/provider";
import { countEnabled, enabledFeatureKeys } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { AdminBusinessDto, FeatureKey, PermissionsDto, PlanId } from "@/types";
import { ActivityFeed } from "./activity-feed";
import { BusinessUsersCard } from "./business-users-card";
import { ClientBrandCard, ClientOnboardingCard } from "./client-onboarding-card";
import { DeleteBusinessDialog } from "./delete-business-dialog";
import { IntegrationCard } from "./integration-card";
import { InstagramAccountsCard } from "./instagram-accounts-card";

const itemKey = (key: FeatureKey) => `features.items.${key.replace(".", "_")}`;

/**
 * Admin client page: permissions (saved to the database, optimistic), plan,
 * logins, activity and the danger zone. Permission changes reach the client's
 * app on their next request and show in "Preview as this client".
 */
export function ClientPermissionsView({ clientId }: { clientId: string }) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const business = useAdminBusiness(clientId);
  const permissions = useAdminPermissions(clientId);
  const [deleting, setDeleting] = useState(false);

  const permissionsKey = qk.admin.permissions(clientId);
  const mutationKey = ["admin", "permissions-write", clientId];
  /** Lists elsewhere (clients table, overview) show plan and feature counts. */
  const refreshLists = () => {
    queryClient.invalidateQueries({ queryKey: qk.admin.businesses });
    queryClient.invalidateQueries({ queryKey: qk.admin.business(clientId) });
    queryClient.invalidateQueries({ queryKey: qk.admin.activity(clientId) });
    queryClient.invalidateQueries({ queryKey: qk.admin.overview });
  };
  /** Only the last of several quick changes writes the server's answer into the cache. */
  const settle = (data: PermissionsDto) => {
    if (queryClient.isMutating({ mutationKey }) <= 1) queryClient.setQueryData(permissionsKey, data);
    refreshLists();
  };
  const optimistic = async (apply: (current: PermissionsDto) => PermissionsDto) => {
    await queryClient.cancelQueries({ queryKey: permissionsKey });
    queryClient.setQueryData<PermissionsDto>(permissionsKey, (current) => current && apply(current));
  };
  // On failure, reload the saved state (undoes the optimistic change); the error toast comes from QueryProvider.
  const reload = () => queryClient.invalidateQueries({ queryKey: permissionsKey });

  const toggle = useMutation<PermissionsDto, ApiClientError, { key: FeatureKey; enabled: boolean }>({
    mutationKey,
    mutationFn: ({ key, enabled }) => apiFetch(`/api/admin/businesses/${clientId}/permissions`, { method: "PATCH", body: { changes: { [key]: enabled } } }),
    onMutate: ({ key, enabled }) =>
      optimistic((current) => {
        const next = { ...current.permissions, [key]: enabled };
        return { ...current, permissions: next, enabled: enabledFeatureKeys(next), matchesPreset: null };
      }),
    onSuccess: settle,
    onError: reload,
  });
  const applyPreset = useMutation<PermissionsDto, ApiClientError, PlanId>({
    mutationKey,
    mutationFn: (plan) => apiFetch(`/api/admin/businesses/${clientId}/permissions/preset`, { method: "POST", body: { plan, setPlan: true } }),
    onMutate: (plan) =>
      optimistic((current) => ({ ...current, plan, permissions: { ...PLAN_PRESETS[plan] }, enabled: enabledFeatureKeys(PLAN_PRESETS[plan]), matchesPreset: plan })),
    onSuccess: settle,
    onError: reload,
  });
  const changePlan = useMutation<AdminBusinessDto, ApiClientError, PlanId>({
    mutationFn: (plan) => apiFetch(`/api/admin/businesses/${clientId}`, { method: "PATCH", body: { plan } }),
    onMutate: async (plan) => {
      await queryClient.cancelQueries({ queryKey: qk.admin.business(clientId) });
      queryClient.setQueryData<AdminBusinessDto>(qk.admin.business(clientId), (b) => b && { ...b, plan });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(qk.admin.business(clientId), data);
      refreshLists();
    },
    onError: () => queryClient.invalidateQueries({ queryKey: qk.admin.business(clientId) }),
  });

  if (business.isPending) return <DetailSkeleton />;
  if (business.isError) return <ErrorState error={business.error} onRetry={() => business.refetch()} />;
  const client = businessToClient(business.data);
  const perms = permissions.data?.permissions;
  const activePreset = permissions.data?.matchesPreset ?? null;

  return (
    <div>
      <Link href="/admin/clients" className="mb-4 inline-flex items-center gap-1 text-body font-semibold text-muted hover:text-foreground">
        <ChevronLeft className="size-4 rtl:-scale-x-100" />
        {t("admin.permissions.back")}
      </Link>

      <header className="mb-6 flex flex-wrap items-center gap-4">
        <Avatar src={client.avatarUrl} initials={client.avatarInitials} tone={client.avatarTone} size="lg" ring={client.connection === "connected" ? "story" : "seen"} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-heading font-bold">{locale === "ar" ? client.businessNameAr : client.businessName}</h1>
          <p className="truncate text-body text-muted">
            {client.handle}
            {client.email && (
              <>
                {" · "}
                <bdi>{client.email}</bdi>
              </>
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <ConnectionPill status={client.connection} />
            <PlanBadge plan={business.data.plan} />
          </div>
        </div>
        <Button size="md" onClick={() => startTransition(() => startPreviewAction(client.id))}>
          <Eye className="size-4" />
          {t("admin.permissions.preview")}
        </Button>
      </header>

      {permissions.isPending ? (
        <Skeleton className="mb-6 h-64 rounded-panel" />
      ) : permissions.isError ? (
        <ErrorState error={permissions.error} onRetry={() => permissions.refetch()} className="mb-6" />
      ) : (
        perms && (
          <>
            <Card className="mb-6">
              <CardHeader>
                <div>
                  <CardTitle>{t("admin.permissions.presets")}</CardTitle>
                  <CardDescription>{t("admin.permissions.presetsHint")}</CardDescription>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-caption text-muted">{t("admin.permissions.plan")}</span>
                  <Segmented<PlanId>
                    label={t("admin.permissions.plan")}
                    value={business.data.plan}
                    onChange={(plan) => changePlan.mutate(plan)}
                    options={PLAN_IDS.map((p) => ({ value: p, label: t(`plans.${p}`) }))}
                  />
                </div>
              </CardHeader>
              <div className="grid gap-3 px-4 pb-4 sm:grid-cols-3">
                {PLAN_IDS.map((plan) => {
                  const active = activePreset === plan;
                  return (
                    <button
                      key={plan}
                      type="button"
                      onClick={() => applyPreset.mutate(plan)}
                      aria-pressed={active}
                      className={cn(
                        "flex items-center justify-between rounded-card border p-3 text-start transition-colors hover:bg-hover",
                        active ? "border-foreground" : "border-border",
                      )}
                    >
                      <span>
                        <PlanBadge plan={plan} />
                        <span className="mt-1.5 block text-caption text-muted">
                          {t("admin.clients.enabledCount", { count: countEnabled(PLAN_PRESETS[plan]), total: FEATURE_KEYS.length })}
                        </span>
                      </span>
                      {active && <Check className="size-5" />}
                    </button>
                  );
                })}
              </div>
            </Card>

            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-body font-semibold">{t("admin.permissions.enabledCount", { count: countEnabled(perms), total: FEATURE_KEYS.length })}</p>
              <p className="text-caption text-muted">
                {t("admin.permissions.subtitle")} {t("admin.permissions.liveNote")}
              </p>
            </div>

            <div className="mb-8 space-y-4">
              {FEATURE_MODULES.map((module) => {
                const moduleOn = module.moduleKey ? perms[module.moduleKey] : true;
                return (
                  <Card key={module.id}>
                    <CardHeader className={cn(moduleOn && module.subFeatures.length > 0 && "border-b border-separator")}>
                      <div>
                        <CardTitle>{t(`features.modules.${module.id}`)}</CardTitle>
                        <CardDescription>{t(`features.moduleHints.${module.id}`)}</CardDescription>
                      </div>
                      {module.moduleKey ? (
                        <Switch
                          checked={moduleOn}
                          onCheckedChange={(v) => toggle.mutate({ key: module.moduleKey!, enabled: v })}
                          aria-label={t(`features.modules.${module.id}`)}
                        />
                      ) : (
                        <Badge variant="neutral">{t("admin.permissions.alwaysOn")}</Badge>
                      )}
                    </CardHeader>
                    {moduleOn ? (
                      <div className="divide-y divide-separator px-4">
                        {module.subFeatures.map((key) => (
                          <FeatureToggle key={key} nested label={t(itemKey(key))} checked={Boolean(perms[key])} onCheckedChange={(v) => toggle.mutate({ key, enabled: v })} />
                        ))}
                      </div>
                    ) : (
                      <p className="px-4 pb-4 text-caption text-muted">{t("admin.permissions.moduleOff")}</p>
                    )}
                  </Card>
                );
              })}
            </div>
          </>
        )
      )}

      <ClientOnboardingCard business={business.data} />

      <InstagramAccountsCard businessId={clientId} />

      <IntegrationCard businessId={clientId} />

      <ClientBrandCard businessId={clientId} />

      <BusinessUsersCard businessId={clientId} />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t("admin.overview.activity")}</CardTitle>
        </CardHeader>
        <ActivityFeed businessId={clientId} pageSize={6} />
      </Card>

      <Card className="border-danger/40">
        <CardHeader>
          <div>
            <CardTitle className="text-danger">{t("admin.delete.zone")}</CardTitle>
            <CardDescription>{t("admin.delete.zoneHint")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Button variant="secondary" className="text-danger" onClick={() => setDeleting(true)}>
            <Trash2 className="size-4" />
            {t("admin.delete.open")}
          </Button>
        </CardContent>
      </Card>

      <DeleteBusinessDialog business={business.data} open={deleting} onOpenChange={setDeleting} />
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true">
      <Skeleton className="mb-4 h-4 w-20" />
      <div className="mb-6 flex items-center gap-4">
        <Skeleton className="size-14 rounded-pill" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <Skeleton className="mb-6 h-40 rounded-panel" />
      <Skeleton className="h-64 rounded-panel" />
    </div>
  );
}
