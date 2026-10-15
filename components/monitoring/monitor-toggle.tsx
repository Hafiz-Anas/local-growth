"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, ChevronRight } from "lucide-react";
import { useActiveClient } from "@/components/providers/active-client-provider";
import { ChipSelect } from "@/components/shared/chip-select";
import { Skeleton } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { MONITOR_DURATIONS, type MonitorDuration } from "@/lib/analysis/monitoring";
import { apiFetch } from "@/lib/api/client";
import { qk, useAction, useMonitoring } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { notify } from "@/store/ui-store";
import type { MonitorItemDto } from "@/types";
import { MonitorTiming } from "./shared";

/**
 * "Monitor this post" on a post's detail view: a switch, then how long (2 hours … 1 year).
 * While monitored: when it ends, Extend, Stop and a link to the full monitoring view.
 */
export function MonitorPostCard({ igMediaId, showLink = true }: { igMediaId: string; showLink?: boolean }) {
  const { t } = useI18n();
  const { isPreview } = useActiveClient();
  const queryClient = useQueryClient();
  const query = useMonitoring();
  const [picking, setPicking] = useState<"start" | "extend" | null>(null);
  const [duration, setDuration] = useState<MonitorDuration>("24h");
  const [confirmStop, setConfirmStop] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.monitoring });
  const start = useAction<MonitorItemDto, MonitorDuration>({
    mutationFn: (d) => apiFetch("/api/monitoring", { method: "POST", body: { igMediaId, duration: d } }),
    onSuccess: () => {
      setPicking(null);
      notify.success(t("monitoring.started"));
    },
    onSettled: refresh,
  });
  const extend = useAction<MonitorItemDto, { id: string; duration: MonitorDuration }>({
    mutationFn: ({ id, duration: d }) => apiFetch(`/api/monitoring/${id}/extend`, { method: "POST", body: { duration: d } }),
    onSuccess: () => {
      setPicking(null);
      notify.success(t("monitoring.extended"));
    },
    onSettled: refresh,
  });
  const stop = useAction<MonitorItemDto, string>({
    mutationFn: (id) => apiFetch(`/api/monitoring/${id}/stop`, { method: "POST" }),
    onSuccess: () => notify.success(t("monitoring.stoppedToast")),
    onSettled: refresh,
  });

  if (query.isPending) return <Skeleton className="h-20 rounded-panel" />;
  if (query.isError) return null;
  const active = query.data.active.find((m) => m.igMediaId === igMediaId) ?? null;
  const full = !active && query.data.active.length >= query.data.limit;
  const busy = start.isPending || extend.isPending || stop.isPending;
  const durations = MONITOR_DURATIONS.map((d) => ({ value: d, label: t(`monitoring.duration.${d}`) }));

  return (
    <Card className="p-4" data-testid="monitor-card">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-pill bg-button-secondary">
          <Activity className="size-5" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold" id="monitor-label">
            {t("monitoring.toggle")}
          </p>
          {active ? (
            <MonitorTiming item={active} className="text-caption text-muted" />
          ) : (
            <p className="text-caption text-muted">{full ? t("monitoring.limitReached", { max: query.data.limit }) : t("monitoring.toggleHint")}</p>
          )}
        </div>
        <Switch
          aria-labelledby="monitor-label"
          checked={Boolean(active) || picking === "start"}
          disabled={busy || full || isPreview}
          onCheckedChange={(on) => {
            if (active && !on) setConfirmStop(true);
            else setPicking(on ? "start" : null);
          }}
          data-testid="monitor-switch"
        />
      </div>

      {picking && (
        <div className="mt-4 border-t border-separator pt-4" data-testid="monitor-durations">
          <ChipSelect
            label={picking === "start" ? t("monitoring.howLong") : t("monitoring.extendBy")}
            hint={t("monitoring.intervalHint")}
            options={durations}
            value={duration}
            onChange={setDuration}
            size="sm"
          />
          <div className="mt-3 flex gap-2">
            <Button
              disabled={busy}
              onClick={() => (picking === "start" ? start.mutate(duration) : active && extend.mutate({ id: active.id, duration }))}
              data-testid="monitor-confirm"
            >
              {picking === "start" ? t("monitoring.start") : t("monitoring.extend")}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setPicking(null)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}

      {active && !picking && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant="success" size="sm" data-testid="monitor-status">
            {t("monitoring.status.active")}
          </Badge>
          <Button variant="secondary" size="sm" disabled={busy || isPreview} onClick={() => setPicking("extend")} data-testid="monitor-extend">
            {t("monitoring.extend")}
          </Button>
          <Button variant="danger" size="sm" disabled={busy || isPreview} onClick={() => setConfirmStop(true)} data-testid="monitor-stop">
            {t("monitoring.stop")}
          </Button>
          {showLink && (
          <Link href={`/post-monitoring/${active.id}`} className="ms-auto inline-flex items-center gap-0.5 text-caption font-semibold text-primary" data-testid="monitor-open">
            {t("monitoring.open")}
            <ChevronRight className="size-3.5 rtl:-scale-x-100" aria-hidden="true" />
          </Link>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title={t("monitoring.stopTitle")}
        description={t("monitoring.stopBody")}
        confirmLabel={t("monitoring.stop")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={() => active && stop.mutate(active.id)}
      />
    </Card>
  );
}
