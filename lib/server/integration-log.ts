import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { sanitize } from "@/lib/services/meta/errors";
import type { IntegrationEventDto } from "@/types";

/**
 * IntegrationEvent: every failed Meta call plus connection milestones (connect,
 * sync, unavailable metrics). Feeds the "Integration log" on the admin client
 * and Onboarding pages. Messages are sanitized — tokens never reach this table.
 */
export interface IntegrationEntry {
  businessId: string | null;
  /** Which integration; "meta" unless said otherwise (e.g. "gemini" for image generation). */
  provider?: "meta" | "gemini" | "mock";
  level?: "error" | "warning" | "info";
  call: string;
  errorCode?: string | null;
  message: string;
  httpStatus?: number | null;
  details?: Prisma.InputJsonObject;
}

export async function logIntegration(entry: IntegrationEntry) {
  const line = `[${entry.provider ?? "meta"}] ${entry.level ?? "error"} ${entry.call}${entry.errorCode ? ` (${entry.errorCode})` : ""}: ${sanitize(entry.message)}`;
  if (entry.level === "info") console.info(line);
  else console.warn(line);
  try {
    await db.integrationEvent.create({
      data: {
        businessId: entry.businessId,
        provider: entry.provider ?? "meta",
        level: entry.level ?? "error",
        call: entry.call,
        errorCode: entry.errorCode ?? null,
        message: sanitize(entry.message),
        httpStatus: entry.httpStatus ?? null,
        details: entry.details ?? {},
      },
    });
  } catch (error) {
    console.error("[meta] couldn't write IntegrationEvent", (error as Error).message);
  }
}

export const INTEGRATION_EVENT_SELECT = {
  id: true,
  level: true,
  call: true,
  errorCode: true,
  message: true,
  httpStatus: true,
  details: true,
  createdAt: true,
} satisfies Prisma.IntegrationEventSelect;

export function toIntegrationEvent(row: Prisma.IntegrationEventGetPayload<{ select: typeof INTEGRATION_EVENT_SELECT }>): IntegrationEventDto {
  return {
    id: row.id,
    level: row.level === "info" || row.level === "warning" ? row.level : "error",
    call: row.call,
    errorCode: row.errorCode,
    message: row.message,
    httpStatus: row.httpStatus,
    details: row.details,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listIntegrationEvents(businessId: string, take = 50): Promise<IntegrationEventDto[]> {
  const rows = await db.integrationEvent.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take, select: INTEGRATION_EVENT_SELECT });
  return rows.map(toIntegrationEvent);
}
