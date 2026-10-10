"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { Client } from "@/types";
import { Avatar } from "./avatar";
import { ConnectionPill } from "./connection-pill";
import { TimeAgo } from "./time-ago";

/** Instagram account-list row for a client: avatar, name, handle, health, plan. */
export function ClientRow({
  client,
  href,
  trailing,
  className,
}: {
  client: Client;
  href?: string;
  trailing?: ReactNode;
  className?: string;
}) {
  const { locale } = useI18n();
  const body = (
    <>
      <Avatar
        src={client.avatarUrl}
        initials={client.avatarInitials}
        tone={client.avatarTone}
        size="md"
        ring={client.connection === "connected" ? "story" : "seen"}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-semibold">{locale === "ar" ? client.businessNameAr : client.businessName}</p>
        <p className="truncate text-body text-muted">
          {client.handle} · <TimeAgo iso={client.lastActivityAt} />
        </p>
      </div>
      <div className="hidden items-center gap-2 sm:flex">
        <ConnectionPill status={client.connection} />
        <PlanBadge plan={client.plan} />
      </div>
      {trailing}
    </>
  );
  const classes = cn("flex items-center gap-3 px-4 py-2.5", href && "transition-colors hover:bg-hover", className);
  return href ? (
    <Link href={href} className={classes}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}

export function PlanBadge({ plan, className }: { plan: Client["plan"]; className?: string }) {
  const { t } = useI18n();
  return (
    <Badge variant={plan === "pro" ? "gradient" : plan === "growth" ? "blue" : "neutral"} className={className}>
      {t(`plans.${plan}`)}
    </Badge>
  );
}
