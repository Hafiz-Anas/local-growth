"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RefreshCw, Unplug } from "lucide-react";
import { useTheme } from "next-themes";
import { useActiveClient, useFeature } from "@/components/providers/active-client-provider";
import { ConnectedNotice, MetaAccountPicker, MetaConnectButton, MetaOutcomeNotice, MissingPermissionsNotice, useMetaOutcome } from "@/components/instagram/meta-connect";
import { Avatar } from "@/components/shared/avatar";
import { ConnectionPill } from "@/components/shared/connection-pill";
import { FeatureToggle } from "@/components/shared/feature-toggle";
import { KuwaitClock } from "@/components/shared/kuwait-clock";
import { PageHeader } from "@/components/shared/page-header";
import { ErrorState, Skeleton } from "@/components/shared/states";
import { TagInput } from "@/components/shared/tag-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ToneSlider } from "@/components/brand/tone-slider";
import { apiFetch } from "@/lib/api/client";
import { qk, useAction, useBrandVoice, useConnection, useNotifications } from "@/lib/api/queries";
import { useMounted } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n/provider";
import { normalizeTheme } from "@/lib/theme-script";
import { cn, formatDateTime, timeAgo } from "@/lib/utils";
import { notify } from "@/store/ui-store";
import type { BrandVoiceDto, InstagramConnectionDto, MeDto, NotificationPrefs } from "@/types";
import { BrandProfileSection } from "./brand-profile";
import { ChangePassword } from "./change-password";
import { ProfilePhoto } from "./profile-photo";
import { Segmented } from "./segmented";

const NOTIFICATION_KEYS: Array<keyof NotificationPrefs> = ["newComments", "approvalNeeded", "weeklyReport", "competitorAlerts", "experimentResults"];

export function SettingsView() {
  const { client, isPreview } = useActiveClient();
  const { t, locale } = useI18n();
  const canBrandVoice = useFeature("settings.brandVoice");

  return (
    <div className="max-w-2xl">
      <PageHeader title={t("settings.title")} />

      <div className="space-y-6">
        {/* Photo and password belong to the signed-in account — not shown while an admin previews. */}
        {!isPreview && (
          <ProfilePhoto
            title={client.handle}
            subtitle={locale === "ar" ? client.businessNameAr : client.businessName}
            avatarUrl={client.avatarUrl}
            initials={client.avatarInitials}
            tone={client.avatarTone}
          />
        )}
        <InstagramCard />
        <BrandProfileSection />
        {canBrandVoice && <BrandVoiceCard />}
        <NotificationsCard />
        {!isPreview && <ChangePassword />}
        <PreferencesCard />
      </div>
    </div>
  );
}

function InstagramCard() {
  const { client, isPreview } = useActiveClient();
  const { t, locale } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const connection = useConnection();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const { outcome, username: connectedAs, clear } = useMetaOutcome();

  const onChanged = (data: InstagramConnectionDto) => {
    queryClient.setQueryData(qk.connection, data);
    // Connection state shows in the top bar and gates actions on other screens.
    queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== qk.connection[0] });
    router.refresh();
  };
  const connect = useAction({
    mutationFn: () => apiFetch<InstagramConnectionDto>("/api/instagram/connection", { method: "POST" }),
    onSuccess: (data) => {
      onChanged(data);
      notify.success(t("settings.instagram.connectedToast"));
    },
  });
  const disconnect = useAction({
    mutationFn: () => apiFetch<InstagramConnectionDto>("/api/instagram/connection", { method: "DELETE" }),
    onSuccess: onChanged,
  });
  const sync = useAction({
    mutationFn: () => apiFetch<{ connection: InstagramConnectionDto }>("/api/instagram/sync", { method: "POST" }),
    onSuccess: ({ connection: data }) => {
      onChanged(data);
      notify.success(data.lastSyncError ? t("instagramConnect.sync.partial") : t("instagramConnect.sync.done"));
    },
  });

  const data = connection.data;
  const status = data?.status ?? client.connection;
  const connected = status === "connected";
  const connectedAt = data?.connectedAt ?? client.connectedAt;
  const flow = data?.flow ?? "mock";
  const isMeta = data?.provider === "meta" && status !== "disconnected";
  // Until the connection status loads, the flow is unknown: don't offer a button that might use the wrong one.
  const busy = connect.isPending || disconnect.isPending || !data;
  const needsReconnect = data?.needsReconnect ?? client.instagramIssue?.reason === "reconnect";
  const syncing = sync.isPending || Boolean(data?.syncing);

  const connectButton =
    flow === "meta" ? (
      <MetaConnectButton
        returnTo="settings"
        variant={connected && !data?.needsReconnect ? "secondary" : "primary"}
        label={status === "disconnected" ? t("settings.instagram.connect") : t("settings.instagram.reconnect")}
        disabled={busy}
      />
    ) : (
      <Button variant={connected ? "secondary" : "primary"} onClick={() => connect.mutate()} disabled={busy || flow === "meta_unavailable"}>
        {connect.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        {connect.isPending ? t("settings.instagram.connecting") : status === "disconnected" ? t("settings.instagram.connect") : t("settings.instagram.reconnect")}
      </Button>
    );

  return (
    <Card id="instagram" className="scroll-mt-[calc(var(--topbar-height)+16px)]">
      <CardHeader>
        <CardTitle>{t("settings.instagram.title")}</CardTitle>
        <ConnectionPill status={status} withIcon />
      </CardHeader>
      <CardContent>
        {connection.isError && <ErrorState error={connection.error} onRetry={() => connection.refetch()} className="mb-3" />}
        {!isPreview && outcome === "connected" && (
          <div className="mb-3">
            <ConnectedNotice username={connectedAs} onDismiss={clear} />
          </div>
        )}
        {!isPreview && outcome && outcome !== "connected" && outcome !== "pick" && <MetaOutcomeNotice outcome={outcome} returnTo="settings" onDismiss={clear} className="mb-3" />}
        <div className="flex flex-wrap items-center gap-3 rounded-card bg-secondary-bg p-3">
          <Avatar src={client.avatarUrl} initials={client.avatarInitials} tone={client.avatarTone} size="md" ring={connected ? "story" : "seen"} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-semibold">{client.handle}</p>
            <p className="truncate text-caption text-muted">
              {status !== "disconnected" && connectedAt
                ? t("settings.instagram.connectedSince", { date: formatDateTime(connectedAt, locale, { day: "numeric", month: "long", year: "numeric" }) })
                : locale === "ar"
                  ? client.businessNameAr
                  : client.businessName}
            </p>
          </div>
          {!isPreview && (
            <div className="flex flex-wrap gap-2">
              {status !== "disconnected" && (
                <Button variant="ghost" onClick={() => setConfirmDisconnect(true)} disabled={busy}>
                  <Unplug className="size-4" />
                  {t("settings.instagram.disconnect")}
                </Button>
              )}
              {connectButton}
            </div>
          )}
        </div>
        {needsReconnect ? (
          <p className="mt-3 flex items-start gap-2 text-caption text-danger">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            {t("instagramConnect.banner.reconnectBody")}
          </p>
        ) : (
          !connected && (
            <p className={cn("mt-3 flex items-start gap-2 text-caption", status === "disconnected" ? "text-danger" : "text-warning")}>
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              {status === "disconnected" ? t("settings.instagram.disconnected") : t("settings.instagram.needsAttention")}
            </p>
          )
        )}
        {flow === "meta_unavailable" && <p className="mt-3 text-caption text-warning">{t("instagramConnect.unavailable")}</p>}

        {isMeta && (
          <>
            {!data?.needsReconnect && <MissingPermissionsNotice permissions={data?.missingPermissions ?? []} returnTo="settings" className="mt-3" />}
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-caption">
              <span className="min-w-0 flex-1 text-muted">
                {syncing
                  ? t("instagramConnect.sync.syncing")
                  : data?.lastSyncAt
                    ? t("instagramConnect.sync.lastSynced", { time: timeAgo(data.lastSyncAt, locale) })
                    : t("instagramConnect.sync.never")}
                {data?.lastSyncError && !syncing && <span className="text-warning"> · {t(`instagramConnect.sync.errors.${data.lastSyncError}`)}</span>}
              </span>
              {!isPreview && (
                <Button variant="secondary" size="sm" onClick={() => sync.mutate()} disabled={syncing || data?.needsReconnect || busy}>
                  {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  {syncing ? t("instagramConnect.sync.syncing") : t("instagramConnect.sync.now")}
                </Button>
              )}
            </div>
            <ul className="mt-3 list-disc space-y-1 ps-4 text-caption text-muted">
              <li>{t("instagramConnect.notes.publishing")}</li>
              <li>{t("instagramConnect.notes.dms")}</li>
            </ul>
          </>
        )}
        <p className="mt-3 text-caption text-muted">{flow === "meta" ? t("instagramConnect.connectHint") : t("settings.instagram.scopes")}</p>
      </CardContent>
      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title={t("settings.instagram.disconnectTitle")}
        description={t("settings.instagram.disconnectBody")}
        confirmLabel={t("settings.instagram.disconnect")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={() => disconnect.mutate()}
      />
      {!isPreview && (
        <MetaAccountPicker
          open={outcome === "pick"}
          onClose={clear}
          onConnected={(result) => {
            onChanged(result.connection);
            clear();
            if (result.outcome === "connected") notify.success(result.username ? t("instagramConnect.outcomes.connectedAs", { username: result.username }) : t("instagramConnect.outcomes.connected"));
            else notify.error(t(`instagramConnect.outcomes.${result.outcome}`));
          }}
        />
      )}
    </Card>
  );
}

function BrandVoiceCard() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const voice = useBrandVoice();
  const [tone, setTone] = useState<number | null>(null);
  const [whatsapp, setWhatsapp] = useState<string | null>(null);

  const save = useAction({
    mutationFn: (patch: Partial<BrandVoiceDto>) => apiFetch<BrandVoiceDto>("/api/brand-voice", { method: "PATCH", body: patch }),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: qk.brandVoice });
      const previous = queryClient.getQueryData<BrandVoiceDto | null>(qk.brandVoice);
      queryClient.setQueryData<BrandVoiceDto | null>(qk.brandVoice, (v) => v && { ...v, ...patch });
      return { previous };
    },
    onError: (_e, _p, context) => queryClient.setQueryData(qk.brandVoice, context?.previous),
    onSuccess: (data) => {
      queryClient.setQueryData(qk.brandVoice, data);
      queryClient.invalidateQueries({ queryKey: qk.generatorOptions });
      setTone(null);
      setWhatsapp(null);
    },
  });

  if (voice.isPending) return <Skeleton className="h-80 rounded-panel" />;
  if (voice.isError) return <ErrorState error={voice.error} onRetry={() => voice.refetch()} />;
  const data = voice.data ?? { toneLevel: 50, defaultHashtags: [], brandWords: [], whatsappNumber: null, priceQuestionsToWhatsApp: false };
  const toneValue = tone ?? data.toneLevel;
  const whatsappValue = whatsapp ?? data.whatsappNumber ?? "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.voice.title")}</CardTitle>
        {save.isPending && <Loader2 className="size-4 animate-spin text-muted" aria-label={t("common.saving")} />}
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <p className="mb-3 text-body font-semibold">{t("settings.voice.tone")}</p>
          <ToneSlider value={toneValue} onChange={setTone} onCommit={(v) => save.mutate({ toneLevel: v })} />
        </div>
        <div>
          <p className="mb-3 text-body font-semibold">{t("settings.voice.hashtags")}</p>
          <TagInput
            values={data.defaultHashtags}
            onChange={(defaultHashtags) => save.mutate({ defaultHashtags })}
            placeholder={t("settings.voice.hashtagPlaceholder")}
            addLabel={t("common.add")}
            normalize={(v) => (v.startsWith("#") ? v : `#${v}`).replace(/\s+/g, "_")}
          />
        </div>
        <div>
          <p className="mb-3 text-body font-semibold">{t("settings.voice.brandWords")}</p>
          <TagInput
            values={data.brandWords}
            onChange={(brandWords) => save.mutate({ brandWords })}
            placeholder={t("settings.voice.brandWordPlaceholder")}
            addLabel={t("common.add")}
          />
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ whatsappNumber: whatsappValue.trim() || null });
          }}
        >
          <label className="mb-1 block text-body font-semibold" htmlFor="whatsapp-number">
            {t("settings.voice.whatsapp")}
          </label>
          <p className="mb-3 text-caption text-muted">{t("settings.voice.whatsappHint")}</p>
          <div className="flex max-w-sm gap-2">
            <Input id="whatsapp-number" value={whatsappValue} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+965 5000 0000" dir="ltr" inputMode="tel" />
            <Button type="submit" variant="secondary" disabled={whatsapp === null || save.isPending}>
              {t("common.save")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function NotificationsCard() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const me = useNotifications();

  const save = useAction({
    mutationFn: (patch: Partial<NotificationPrefs>) => apiFetch<{ notifications: NotificationPrefs }>("/api/me/notifications", { method: "PATCH", body: patch }),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: qk.me });
      const previous = queryClient.getQueryData<MeDto>(qk.me);
      queryClient.setQueryData<MeDto>(qk.me, (m) => m && { ...m, user: { ...m.user, notifications: { ...m.user.notifications, ...patch } } });
      return { previous };
    },
    onError: (_e, _p, context) => queryClient.setQueryData(qk.me, context?.previous),
  });

  const notifications = me.data;

  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle>{t("settings.notifications.title")}</CardTitle>
      </CardHeader>
      {me.isPending ? (
        <div className="space-y-3 p-4">
          {NOTIFICATION_KEYS.map((k) => (
            <Skeleton key={k} className="h-10" />
          ))}
        </div>
      ) : me.isError ? (
        <ErrorState error={me.error} onRetry={() => me.refetch()} className="m-4" />
      ) : (
        <div className="divide-y divide-separator px-4 pb-1">
          {NOTIFICATION_KEYS.map((key) => (
            <FeatureToggle
              key={key}
              label={t(`settings.notifications.${key}`)}
              description={t(`settings.notifications.${key}Hint`)}
              checked={Boolean(notifications?.[key])}
              onCheckedChange={(v) => save.mutate({ [key]: v })}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

/** Language, theme and Kuwait clock — shared by user and admin settings. Saved to the account by PreferencesSync. */
export function PreferencesCard() {
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle>{t("settings.preferences.title")}</CardTitle>
      </CardHeader>
      <div className="divide-y divide-separator px-4">
        <div className="flex flex-wrap items-center justify-between gap-3 py-3">
          <span className="text-body font-semibold">{t("settings.preferences.language")}</span>
          <Segmented
            label={t("settings.preferences.language")}
            value={locale}
            onChange={setLocale}
            options={[
              { value: "en", label: "English" },
              { value: "ar", label: "العربية" },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 py-3">
          <span className="text-body font-semibold">{t("settings.preferences.theme")}</span>
          <Segmented
            label={t("settings.preferences.theme")}
            value={mounted ? normalizeTheme(theme) : "dark"}
            onChange={setTheme}
            options={[
              { value: "light", label: t("settings.preferences.light") },
              { value: "dark", label: t("settings.preferences.dark") },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <p className="text-body font-semibold">{t("settings.preferences.time")}</p>
            <p className="text-caption text-muted">{t("settings.preferences.timezone")}</p>
          </div>
          <KuwaitClock className="text-end" />
        </div>
      </div>
    </Card>
  );
}
