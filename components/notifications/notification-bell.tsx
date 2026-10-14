"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, CalendarCheck, CalendarX, FileText, Lightbulb, MessageCircle, type LucideIcon } from "lucide-react";
import { useActiveClient, useFeature } from "@/components/providers/active-client-provider";
import { TimeAgo } from "@/components/shared/time-ago";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/api/client";
import { publishReasonText } from "@/lib/api/errors";
import { qk, useAction, useNotificationCenter } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { cn, formatDateTime, formatNumber } from "@/lib/utils";
import type { NotificationDto, NotificationsDto } from "@/types";

const ICONS: Record<NotificationDto["type"], LucideIcon> = {
  recommendations_ready: Lightbulb,
  weekly_report: FileText,
  instagram_reconnect: AlertTriangle,
  post_published: CalendarCheck,
  post_failed: CalendarX,
  replies_waiting: MessageCircle,
};

/** The text of a notification in the current language, from its type and params. */
export function useNotificationText() {
  const { t, locale } = useI18n();
  return (n: NotificationDto) => {
    const p = n.params;
    const vars: Record<string, string | number> = {
      count: typeof p.count === "number" ? formatNumber(p.count, locale) : String(p.count ?? ""),
      date: typeof p.end === "string" ? formatDateTime(p.end, locale, { day: "numeric", month: "short" }) : "",
      reason: n.type === "post_failed" ? publishReasonText(typeof p.reason === "string" ? p.reason : null, t) : "",
    };
    return { title: t(`notifications.types.${n.type}.title`, vars), body: t(`notifications.types.${n.type}.body`, vars) };
  };
}

/**
 * The bell in the header: unread count, the latest notifications (newest first), mark one
 * read by opening it, mark all as read. Works the same on phones. Hidden when the client's
 * notifications module is off, and in admin preview.
 */
export function NotificationBell() {
  const { t } = useI18n();
  const { isPreview } = useActiveClient();
  const enabled = useFeature("notifications");
  const router = useRouter();
  const queryClient = useQueryClient();
  const center = useNotificationCenter(enabled);
  const text = useNotificationText();

  const markRead = useAction({
    mutationFn: (id: string) => apiFetch<NotificationsDto>(`/api/notifications/${id}`, { method: "PATCH" }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: qk.notificationCenter });
      queryClient.setQueryData<NotificationsDto>(qk.notificationCenter, (d) => {
        if (!d) return d;
        const target = d.items.find((n) => n.id === id);
        return { items: d.items.map((n) => (n.id === id ? { ...n, read: true } : n)), unread: Math.max(0, d.unread - (target && !target.read ? 1 : 0)) };
      });
    },
    onSuccess: (data) => queryClient.setQueryData(qk.notificationCenter, data),
  });
  const markAll = useAction({
    mutationFn: () => apiFetch<NotificationsDto>("/api/notifications/read-all", { method: "POST" }),
    onMutate: () => queryClient.setQueryData<NotificationsDto>(qk.notificationCenter, (d) => d && { items: d.items.map((n) => ({ ...n, read: true })), unread: 0 }),
    onSuccess: (data) => queryClient.setQueryData(qk.notificationCenter, data),
  });

  if (!enabled || isPreview) return null;
  const items = center.data?.items ?? [];
  const unread = center.data?.unread ?? 0;
  const label = unread ? t("notifications.bellUnread", { count: unread }) : t("notifications.bell");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative" aria-label={label} data-testid="notification-bell">
          <Bell aria-hidden="true" />
          {unread > 0 && (
            <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-pill bg-danger px-1 text-[10px] font-bold text-white" aria-hidden="true">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <DropdownMenuLabel className="p-0 text-body font-bold">{t("notifications.title")}</DropdownMenuLabel>
          {unread > 0 && (
            <Button variant="link" size="sm" className="text-caption" onClick={() => markAll.mutate()}>
              {t("notifications.markAll")}
            </Button>
          )}
        </div>
        <DropdownMenuSeparator className="m-0" />
        <div className="max-h-[min(26rem,70vh)] overflow-y-auto">
          {!items.length ? (
            <p className="px-3 py-6 text-center text-caption text-muted">{center.isPending ? t("notifications.loading") : t("notifications.empty")}</p>
          ) : (
            items.map((n) => {
              const Icon = ICONS[n.type];
              const { title, body } = text(n);
              return (
                <DropdownMenuItem
                  key={n.id}
                  data-testid="notification"
                  data-read={n.read}
                  className={cn("flex items-start gap-3 rounded-none px-3 py-2.5", !n.read && "bg-primary-soft/40")}
                  onSelect={() => {
                    if (!n.read) markRead.mutate(n.id);
                    router.push(n.href);
                  }}
                >
                  <Icon className={cn("mt-0.5 size-5 shrink-0", n.type === "instagram_reconnect" || n.type === "post_failed" ? "text-danger" : "")} aria-hidden="true" />
                  <span className="min-w-0 flex-1 text-start">
                    <span className="block text-body font-semibold">{title}</span>
                    <span className="block text-caption text-muted">{body}</span>
                    <TimeAgo iso={n.createdAt} className="text-caption text-muted" />
                  </span>
                  {!n.read && <span className="mt-2 size-2 shrink-0 rounded-pill bg-primary" aria-label={t("notifications.unread")} />}
                </DropdownMenuItem>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
