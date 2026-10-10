"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { Segmented } from "@/components/settings/segmented";
import { Avatar } from "@/components/shared/avatar";
import { FEATURE_KEYS } from "@/config/features";
import { PLAN_IDS, PLAN_PRESETS } from "@/config/plans";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { qk } from "@/lib/api/queries";
import { countEnabled } from "@/lib/permissions";
import { notify } from "@/store/ui-store";
import type { AdminSettingsDto, PlanId } from "@/types";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, Skeleton, SkeletonList } from "@/components/shared/states";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { businessToClient, useAdminBusinesses, useAdminSettings, useAdminSystem } from "@/lib/api/admin";
import { useI18n } from "@/lib/i18n/provider";
import { cn, formatDateTime, formatNumber, timeAgo } from "@/lib/utils";
import type { ServiceHealth } from "@/types";

const HEALTH: Record<ServiceHealth, { icon: typeof CheckCircle2; className: string }> = {
  operational: { icon: CheckCircle2, className: "text-success" },
  degraded: { icon: AlertTriangle, className: "text-warning" },
  down: { icon: XCircle, className: "text-danger" },
};

/** Admin System page: integration health, sign-up and Instagram settings, API usage. The admin's own account is under Profile. */
export function SystemView() {
  const { t, locale } = useI18n();
  const system = useAdminSystem();
  const businesses = useAdminBusinesses();
  const byId = new Map((businesses.data ?? []).map((b) => [b.id, businessToClient(b)]));

  return (
    <div>
      <PageHeader title={t("admin.system.title")} subtitle={t("admin.system.subtitle")} />
      <p className="-mt-4 mb-6 text-caption text-muted">{t("admin.system.mockNote")}</p>

      {system.isPending ? (
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          <Skeleton className="h-36 rounded-panel" />
          <Skeleton className="h-36 rounded-panel" />
        </div>
      ) : system.isError ? (
        <ErrorState error={system.error} onRetry={() => system.refetch()} className="mb-6" />
      ) : (
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          <ServiceCard
            title={t("admin.system.igApi")}
            health={system.data.instagramApi.status}
            rows={[
              [t("admin.system.latency"), `${system.data.instagramApi.latencyMs} ms`],
              [t("admin.system.uptime"), `${system.data.instagramApi.uptimePct}%`],
            ]}
          />
          <ServiceCard
            title={t("admin.system.webhooks")}
            health={system.data.webhooks.status}
            rows={[
              [t("admin.system.lastEvent"), timeAgo(system.data.webhooks.lastEventAt, locale)],
              [t("admin.system.delivered"), formatNumber(system.data.webhooks.deliveredToday, locale)],
              [t("admin.system.failed"), formatNumber(system.data.webhooks.failedToday, locale)],
            ]}
          />
        </div>
      )}

      <SelfSignupCard />
      <InstagramSettingsCard />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t("admin.system.rateLimits")}</CardTitle>
            <CardDescription>{t("admin.system.rateLimitsHint")}</CardDescription>
          </div>
        </CardHeader>
        {system.isPending || businesses.isPending ? (
          <SkeletonList rows={3} />
        ) : (
          <ul className="divide-y divide-separator">
            {(system.data?.rateLimits ?? []).map((usage) => {
              const client = byId.get(usage.businessId);
              if (!client) return null;
              const pct = usage.limit ? Math.round((usage.used / usage.limit) * 100) : 0;
              const level = pct >= 90 ? "bg-danger" : pct >= 70 ? "bg-warning" : "bg-primary";
              return (
                <li key={usage.businessId} className="flex items-center gap-3 px-4 py-3">
                  <Avatar src={client.avatarUrl} initials={client.avatarInitials} tone={client.avatarTone} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-body font-semibold">{client.handle}</span>
                      <span className="shrink-0 text-caption text-muted tabular-nums">
                        {t("admin.system.calls", { used: usage.used, limit: usage.limit })} · {pct}%
                      </span>
                    </div>
                    <div
                      className="mt-1.5 h-1.5 overflow-hidden rounded-pill bg-border"
                      role="meter"
                      aria-valuenow={usage.used}
                      aria-valuemin={0}
                      aria-valuemax={usage.limit}
                      aria-label={client.handle}
                    >
                      <div className={cn("h-full rounded-pill", level)} style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-1 text-caption text-muted" suppressHydrationWarning>
                      {t("admin.system.resets", { time: formatDateTime(usage.resetsAt, locale, { hour: "numeric", minute: "2-digit" }) })}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** "Default plan for self sign-ups": the plan preset new businesses from the public sign-up start on. */
function SelfSignupCard() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const settings = useAdminSettings();
  const save = useMutation<AdminSettingsDto, ApiClientError, PlanId, { previous?: AdminSettingsDto }>({
    mutationFn: (selfSignupPlan) => apiFetch("/api/admin/settings", { method: "PATCH", body: { selfSignupPlan } }),
    onMutate: async (selfSignupPlan) => {
      await queryClient.cancelQueries({ queryKey: qk.admin.settings });
      const previous = queryClient.getQueryData<AdminSettingsDto>(qk.admin.settings);
      queryClient.setQueryData<AdminSettingsDto>(qk.admin.settings, (s) => s && { ...s, selfSignupPlan });
      return { previous };
    },
    onError: (_e, _plan, context) => queryClient.setQueryData(qk.admin.settings, context?.previous),
    onSuccess: (data) => {
      queryClient.setQueryData(qk.admin.settings, data);
      notify.success(t("admin.system.selfSignupSaved", { plan: t(`plans.${data.selfSignupPlan}`) }));
    },
  });

  return (
    <Card className="mb-6">
      <CardHeader>
        <div>
          <CardTitle>{t("admin.system.selfSignup")}</CardTitle>
          <CardDescription>{t("admin.system.selfSignupHint")}</CardDescription>
        </div>
      </CardHeader>
      <div className="px-4 pb-4">
        {settings.isPending ? (
          <Skeleton className="h-9 w-64" />
        ) : settings.isError ? (
          <ErrorState error={settings.error} onRetry={() => settings.refetch()} />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Segmented<PlanId>
              label={t("admin.system.selfSignup")}
              value={settings.data.selfSignupPlan}
              onChange={(plan) => save.mutate(plan)}
              options={PLAN_IDS.map((p) => ({ value: p, label: t(`plans.${p}`) }))}
            />
            <span className="text-caption text-muted">
              {t("admin.clients.enabledCount", { count: countEnabled(PLAN_PRESETS[settings.data.selfSignupPlan]), total: FEATURE_KEYS.length })}
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}

/** Instagram: "Require Instagram connection to finish onboarding" (default off) and the Meta integration's state. */
function InstagramSettingsCard() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const settings = useAdminSettings();
  const save = useMutation<AdminSettingsDto, ApiClientError, boolean, { previous?: AdminSettingsDto }>({
    mutationFn: (requireInstagramConnection) => apiFetch("/api/admin/settings", { method: "PATCH", body: { requireInstagramConnection } }),
    onMutate: async (requireInstagramConnection) => {
      await queryClient.cancelQueries({ queryKey: qk.admin.settings });
      const previous = queryClient.getQueryData<AdminSettingsDto>(qk.admin.settings);
      queryClient.setQueryData<AdminSettingsDto>(qk.admin.settings, (s) => s && { ...s, requireInstagramConnection });
      return { previous };
    },
    onError: (_e, _value, context) => queryClient.setQueryData(qk.admin.settings, context?.previous),
    onSuccess: (data) => {
      queryClient.setQueryData(qk.admin.settings, data);
      notify.success(t("admin.system.instagram.saved"));
    },
  });
  const meta = settings.data?.meta;

  return (
    <Card className="mb-6">
      <CardHeader>
        <div>
          <CardTitle>{t("admin.system.instagram.title")}</CardTitle>
          <CardDescription>{t("admin.system.instagram.hint")}</CardDescription>
        </div>
      </CardHeader>
      <div className="px-4 pb-4">
        {settings.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : settings.isError ? (
          <ErrorState error={settings.error} onRetry={() => settings.refetch()} />
        ) : (
          <>
            <label className="flex items-start justify-between gap-4">
              <span className="min-w-0">
                <span className="block text-body font-semibold">{t("admin.system.instagram.require")}</span>
                <span className="block text-caption text-muted">{t("admin.system.instagram.requireHint")}</span>
              </span>
              <Switch checked={settings.data.requireInstagramConnection} onCheckedChange={(v) => save.mutate(v)} disabled={save.isPending} />
            </label>
            {meta && (
              <p className={cn("mt-4 rounded-button bg-secondary-bg px-3 py-2 text-caption", meta.flow === "meta_unavailable" && "text-warning")}>
                <span className="font-semibold">{t(`admin.system.instagram.flow.${meta.flow}`)}</span>
                {meta.configured && meta.graphVersion && <> · {t("admin.system.instagram.graphVersion", { version: meta.graphVersion })}</>}
                {!meta.configured && meta.missing.length > 0 && <> · {t("admin.system.instagram.missing", { list: meta.missing.join(", ") })}</>}
              </p>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function ServiceCard({ title, health, rows }: { title: string; health: ServiceHealth; rows: Array<[string, string]> }) {
  const { t } = useI18n();
  const { icon: Icon, className } = HEALTH[health];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <span className={cn("inline-flex items-center gap-1 text-caption font-semibold", className)}>
          <Icon className="size-4" aria-hidden="true" />
          {t(`admin.system.status.${health}`)}
        </span>
      </CardHeader>
      <dl className="grid grid-cols-3 gap-2 px-4 pb-4">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-button bg-secondary-bg px-3 py-2">
            <dt className="truncate text-caption text-muted">{label}</dt>
            <dd className="mt-0.5 text-body font-semibold tabular-nums" suppressHydrationWarning>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
