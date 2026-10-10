"use client";

import { SITE } from "@/config/site";
import { useNow } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n/provider";
import { intlLocale } from "@/lib/utils";

/** Live clock in Asia/Kuwait. Renders a placeholder on the server to avoid a time mismatch. */
export function KuwaitClock({ className }: { className?: string }) {
  const { locale } = useI18n();
  const now = useNow();

  if (!now) return <span className={className}>--:--:--</span>;

  const time = new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: SITE.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(now);
  const date = new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: SITE.timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);

  return (
    <span className={className}>
      <span className="block text-heading font-bold tabular-nums">{time}</span>
      <span className="block text-caption text-muted">{date}</span>
    </span>
  );
}
