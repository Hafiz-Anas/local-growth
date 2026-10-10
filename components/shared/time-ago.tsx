"use client";

import { useI18n } from "@/lib/i18n/provider";
import { timeAgo } from "@/lib/utils";

export function TimeAgo({ iso, className }: { iso: string; className?: string }) {
  const { locale } = useI18n();
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {timeAgo(iso, locale)}
    </time>
  );
}
