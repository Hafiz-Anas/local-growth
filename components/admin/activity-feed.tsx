"use client";

import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  FlaskConical,
  History,
  KeyRound,
  Loader2,
  Plug,
  Send,
  Settings2,
  Sparkles,
  Store,
  Tag,
  UserRound,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Avatar } from "@/components/shared/avatar";
import { EmptyState, ErrorState, SkeletonList } from "@/components/shared/states";
import { TimeAgo } from "@/components/shared/time-ago";
import { Button } from "@/components/ui/button";
import { activityText, useAdminActivity, useAdminBusinesses } from "@/lib/api/admin";
import { useI18n } from "@/lib/i18n/provider";
import { initials, toneFor } from "@/lib/utils";
import type { ActivityLogDto } from "@/types";

function iconFor(action: string): LucideIcon {
  if (action.startsWith("reply.")) return CheckCircle2;
  if (action.startsWith("dm_rule.")) return Zap;
  if (action.startsWith("post.")) return action === "post.published" ? Send : CalendarClock;
  if (action.startsWith("drafts.")) return Sparkles;
  if (action.startsWith("experiment.")) return FlaskConical;
  if (action === "instagram.connection_issue") return AlertTriangle;
  if (action.startsWith("instagram.")) return Plug;
  if (action.startsWith("permissions.")) return Settings2;
  if (action === "business.plan_changed") return Tag;
  if (action.startsWith("business.")) return Store;
  if (action.includes("password")) return KeyRound;
  if (action.startsWith("user.")) return UserRound;
  if (action.startsWith("competitor.")) return Users;
  return History;
}

/** Instagram-notifications-style activity list with "Load more". */
export function ActivityFeed({ businessId, pageSize = 8 }: { businessId?: string; pageSize?: number }) {
  const { t, locale } = useI18n();
  const activity = useAdminActivity(businessId, pageSize);
  const businesses = useAdminBusinesses();
  const avatars = new Map((businesses.data ?? []).map((b) => [b.id, b.avatarUrl]));

  if (activity.isPending) return <SkeletonList rows={4} />;
  if (activity.isError) return <ErrorState error={activity.error} onRetry={() => activity.refetch()} className="m-4" />;
  const items = activity.data.pages.flatMap((p) => p.items);
  if (items.length === 0) return <EmptyState icon={History} title={t("admin.activity.emptyTitle")} hint={t("admin.activity.emptyHint")} />;

  const subject = (item: ActivityLogDto) => item.business?.name ?? item.user?.name ?? t("admin.activity.system");
  return (
    <>
      <ul className="pb-2">
        {items.map((item) => {
          const Icon = iconFor(item.action);
          const name = subject(item);
          return (
            <li key={item.id} className="flex items-start gap-3 px-4 py-2.5">
              <span className="relative">
                <Avatar
                  src={item.business ? avatars.get(item.business.id) : null}
                  initials={initials(name)}
                  tone={item.business ? toneFor(item.business.id) : "night"}
                  size="md"
                />
                <span className="absolute -end-1 -bottom-1 flex size-5 items-center justify-center rounded-pill border-2 border-background bg-button-secondary">
                  <Icon className="size-3" aria-hidden="true" />
                </span>
              </span>
              <p className="min-w-0 flex-1 text-body">
                <span className="font-semibold">{name}</span> <bdi>{activityText(item, t, locale)}</bdi>
                {item.user && item.user.role === "admin" && item.business && (
                  <span className="text-muted"> · {t("admin.activity.byAdmin", { name: item.user.name })}</span>
                )}{" "}
                <TimeAgo iso={item.createdAt} className="text-muted" />
              </p>
            </li>
          );
        })}
      </ul>
      {activity.hasNextPage && (
        <div className="px-4 pb-4">
          <Button variant="secondary" className="w-full" onClick={() => activity.fetchNextPage()} disabled={activity.isFetchingNextPage}>
            {activity.isFetchingNextPage && <Loader2 className="size-4 animate-spin" />}
            {t("admin.activity.loadMore")}
          </Button>
        </div>
      )}
    </>
  );
}
