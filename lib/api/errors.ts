import { notify } from "@/store/ui-store";
import { ApiClientError } from "./client";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Codes with their own friendly message under `errors.*` in the locale files. */
const KNOWN = new Set([
  "validation_error",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "invalid_token",
  "invalid_password",
  "payload_too_large",
  "unsupported_media_type",
  "instagram_not_connected",
  "instagram_permission",
  "instagram_unavailable",
  "instagram_error",
  "ai_error",
  "assistant_unavailable",
  "assistant_limit",
  "recommendations_unavailable",
  "recommendations_limit",
  "image_unavailable",
  "email_unavailable",
  "dm_window_closed",
  "comment_unavailable",
  "regenerate_unavailable",
  "regenerate_limit",
  "analysis_limit",
  "monitor_exists",
  "account_limit",
  "account_switched",
  "network_error",
  "internal_error",
]);

/**
 * A friendly, localized sentence for any error thrown by the API helpers.
 * Server messages are English and technical, so they're only used as a last resort.
 */
export function errorMessage(error: unknown, t: Translate): string {
  if (error instanceof ApiClientError) {
    if (error.code === "validation_error") {
      const fields = Array.isArray(error.details)
        ? [...new Set((error.details as Array<{ path?: string }>).map((d) => d.path).filter(Boolean))]
        : [];
      return fields.length ? t("errors.validation_fields", { fields: fields.join(", ") }) : t("errors.validation_error");
    }
    if (error.code === "publish_failed") return publishReasonText(publishReasonOf(error), t);
    if (error.code === "reply_invalid") {
      const reason = Array.isArray(error.details) ? (error.details as Array<{ path?: string; message?: string }>).find((d) => d.path === "reason")?.message : undefined;
      const key = `engagement.queue.problem.${reason}`;
      const text = reason ? t(key) : key;
      return text === key ? t("errors.validation_error") : text;
    }
    if (error.code === "dm_failed") {
      const reason = Array.isArray(error.details) ? (error.details as Array<{ path?: string; message?: string }>).find((d) => d.path === "reason")?.message : undefined;
      const key = `errors.dm.${reason}`;
      const text = reason ? t(key) : key;
      return text === key ? t("errors.instagram_error") : text;
    }
    if (error.code === "monitor_limit") {
      const max = Array.isArray(error.details) ? (error.details as Array<{ path?: string; message?: string }>).find((d) => d.path === "max")?.message : undefined;
      return t("errors.monitor_limit", { max: max ?? "" });
    }
    if (KNOWN.has(error.code)) return t(`errors.${error.code}`);
    return error.status >= 500 ? t("errors.internal_error") : t("errors.generic");
  }
  return t("errors.generic");
}

function publishReasonOf(error: ApiClientError): string | null {
  const detail = Array.isArray(error.details) ? (error.details as Array<{ path?: string; message?: string }>).find((d) => d.path === "reason") : undefined;
  return detail?.message ?? null;
}

/** Why a post couldn't be published (reason codes from lib/server/publishing.ts, also stored on drafts as publishError). */
export function publishReasonText(reason: string | null, t: Translate): string {
  const key = `publish.errors.${reason}`;
  const text = reason ? t(key) : key;
  return text === key ? t("publish.errors.failed") : text;
}

export function isInstagramNotConnected(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === "instagram_not_connected";
}

/**
 * Default reaction to a failed action: the Instagram prompt for
 * `instagram_not_connected`, nothing for 401 (we're already redirecting to
 * login), and a toast for everything else.
 */
export function reportError(error: unknown, t: Translate) {
  if (error instanceof ApiClientError && (error.status === 401 || error.code === "account_switched")) return;
  if (isInstagramNotConnected(error)) return notify.instagramRequired(t("errors.instagram_not_connected"));
  notify.error(errorMessage(error, t));
}
