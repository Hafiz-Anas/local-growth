import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";

export interface ActivityEntry {
  businessId?: string | null;
  userId?: string | null;
  /** Dotted action name, e.g. "permissions.updated". */
  action: string;
  details?: Prisma.InputJsonValue;
}

/** Appends to the audit trail. Pass a transaction client to log atomically with the change. */
export async function logActivity(entry: ActivityEntry, client: Prisma.TransactionClient = db) {
  await client.activityLog.create({
    data: { businessId: entry.businessId ?? null, userId: entry.userId ?? null, action: entry.action, details: entry.details ?? {} },
  });
}
