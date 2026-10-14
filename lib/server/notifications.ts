import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { NOTIFICATION_TYPES, isNotificationType, notificationRelevant, type NotificationType } from "@/lib/notifications";
import { isFeatureEnabled, permissionsFromRows } from "@/lib/permissions";
import { notificationPrefsSchema } from "@/lib/validation/api";
import type { NotificationDto, NotificationsDto } from "@/types";
import { notFound } from "./http";

/**
 * Notifications: `notify()` is the one entry point for every feature. It checks the
 * client's modules and each user's preferences, stores one row per recipient (the in-app
 * notification center reads those) and hands the rows to the delivery channels.
 * Only in-app exists today; email will be another NotificationChannel (with its own
 * preference per type), using Notification.emailedAt to send each one once.
 * Never throws: a notification must not break the action that caused it.
 */

export interface NotifyInput {
  businessId: string;
  type: NotificationType;
  /** Values for the localized text (notifications.types.<type> in the locale files). */
  params?: Record<string, string | number>;
  /** Defaults to the type's page. */
  href?: string;
  /** One live notification per subject: a new event updates that row instead of adding one. */
  dedupeKey?: string;
  /**
   * With a dedupeKey: an already-read row only comes back as unread when it was created at
   * least this long ago (e.g. a daily check shouldn't re-alert every day). Default: always.
   */
  renotifyAfterMs?: number;
}

export interface NotificationChannel {
  name: string;
  deliver(rows: Array<{ id: string; userId: string; type: NotificationType }>): Promise<void>;
}

/** The in-app center reads the stored rows, so there is nothing more to deliver. */
const inApp: NotificationChannel = { name: "in-app", deliver: async () => {} };
const CHANNELS: NotificationChannel[] = [inApp];

export async function notify(input: NotifyInput): Promise<number> {
  try {
    const def = NOTIFICATION_TYPES[input.type];
    const business = await db.business.findUnique({
      where: { id: input.businessId },
      select: {
        permissions: { select: { featureKey: true, enabled: true } },
        users: { where: { role: "USER", status: "ACTIVE" }, select: { id: true, notificationPrefs: true } },
      },
    });
    if (!business) return 0;
    const permissions = permissionsFromRows(business.permissions);
    if (!isFeatureEnabled(permissions, "notifications")) return 0;
    if (!notificationRelevant(def.features, (key) => isFeatureEnabled(permissions, key))) return 0;

    const recipients = business.users.filter((u) => notificationPrefsSchema.catch(notificationPrefsSchema.parse({})).parse(u.notificationPrefs ?? {})[def.pref]);
    const params = (input.params ?? {}) as Prisma.InputJsonObject;
    const href = input.href ?? def.href;
    const now = new Date();
    const rows: Array<{ id: string; userId: string; type: NotificationType }> = [];
    for (const user of recipients) {
      if (!input.dedupeKey) {
        const row = await db.notification.create({ data: { userId: user.id, businessId: input.businessId, type: input.type, params, href }, select: { id: true } });
        rows.push({ id: row.id, userId: user.id, type: input.type });
        continue;
      }
      const existing = await db.notification.findUnique({ where: { userId_dedupeKey: { userId: user.id, dedupeKey: input.dedupeKey } }, select: { id: true, readAt: true, createdAt: true } });
      if (!existing) {
        const row = await db.notification.create({ data: { userId: user.id, businessId: input.businessId, type: input.type, params, href, dedupeKey: input.dedupeKey }, select: { id: true } });
        rows.push({ id: row.id, userId: user.id, type: input.type });
        continue;
      }
      const resurface = !existing.readAt || now.getTime() - existing.createdAt.getTime() >= (input.renotifyAfterMs ?? 0);
      await db.notification.update({
        where: { id: existing.id },
        data: { params, href, type: input.type, ...(resurface && { readAt: null, createdAt: now, emailedAt: null }) },
      });
      if (resurface) rows.push({ id: existing.id, userId: user.id, type: input.type });
    }
    for (const channel of CHANNELS) await channel.deliver(rows);
    return rows.length;
  } catch (error) {
    console.error(`[notify] ${input.type} for ${input.businessId} failed`, (error as Error).message);
    return 0;
  }
}

/** Replies waiting for approval: one notification that keeps the current count. */
export async function notifyRepliesWaiting(businessId: string): Promise<void> {
  const count = await db.replyDraft.count({ where: { businessId, status: "PENDING" } }).catch(() => 0);
  if (count > 0) await notify({ businessId, type: "replies_waiting", params: { count }, dedupeKey: "replies_waiting" });
}

// ─── The notification center ─────────────────────────────────────────────────

const SELECT = { id: true, type: true, params: true, href: true, readAt: true, createdAt: true } as const;

function toDto(row: Prisma.NotificationGetPayload<{ select: typeof SELECT }>): NotificationDto | null {
  if (!isNotificationType(row.type)) return null;
  return { id: row.id, type: row.type, params: row.params as NotificationDto["params"], href: row.href, read: Boolean(row.readAt), createdAt: row.createdAt.toISOString() };
}

export async function listNotifications(userId: string, limit = 30): Promise<NotificationsDto> {
  const [rows, unread] = await Promise.all([
    db.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit, select: SELECT }),
    db.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { items: rows.map(toDto).filter((n): n is NotificationDto => n !== null), unread };
}

export async function markNotificationRead(userId: string, id: string): Promise<void> {
  const { count } = await db.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
  if (!count && !(await db.notification.count({ where: { id, userId } }))) throw notFound("Notification");
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  return (await db.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } })).count;
}

/** Daily: Meta connections that need the owner to log in again (expired or revoked), re-alerting every 3 days at most. */
export async function notifyReconnectsNeeded(): Promise<number> {
  const rows = await db.instagramConnection.findMany({
    where: { provider: "META", OR: [{ status: { in: ["NEEDS_RECONNECT", "EXPIRED"] } }, { status: "CONNECTED", tokenExpiresAt: { lte: new Date() } }] },
    select: { businessId: true },
  });
  let sent = 0;
  for (const { businessId } of rows) sent += await notify({ businessId, type: "instagram_reconnect", dedupeKey: "instagram_reconnect", renotifyAfterMs: 3 * 24 * 60 * 60 * 1000 });
  return sent;
}
