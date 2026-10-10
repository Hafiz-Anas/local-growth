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
  "image_unavailable",
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
    if (KNOWN.has(error.code)) return t(`errors.${error.code}`);
    return error.status >= 500 ? t("errors.internal_error") : t("errors.generic");
  }
  return t("errors.generic");
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
  if (error instanceof ApiClientError && error.status === 401) return;
  if (isInstagramNotConnected(error)) return notify.instagramRequired(t("errors.instagram_not_connected"));
  notify.error(errorMessage(error, t));
}
