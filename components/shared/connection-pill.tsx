"use client";

import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { ConnectionStatus } from "@/types";

const DOT: Record<ConnectionStatus, string> = {
  connected: "bg-success",
  needs_attention: "bg-warning",
  disconnected: "bg-danger",
};

/** Status dot + text label — state is never conveyed by colour alone. */
export function ConnectionPill({
  status,
  withIcon = false,
  className,
}: {
  status: ConnectionStatus;
  withIcon?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-pill border border-border px-2.5 text-caption font-semibold whitespace-nowrap",
        className,
      )}
    >
      {withIcon && <InstagramGlyph />}
      <span className={cn("size-2 rounded-pill", DOT[status])} aria-hidden="true" />
      {t(`connection.${status}`)}
    </span>
  );
}

/** Generic camera glyph used to signal "Instagram connection" (not the Instagram logo). */
function InstagramGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}
