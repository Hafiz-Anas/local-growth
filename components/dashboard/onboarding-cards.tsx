"use client";

import { useState } from "react";
import Link from "next/link";
import { Camera, PartyPopper, X } from "lucide-react";
import { NavIcon } from "@/components/layout/nav-icon";
import { useActiveClient } from "@/components/providers/active-client-provider";
import { Button } from "@/components/ui/button";
import { USER_NAV } from "@/config/navigation";
import { useI18n } from "@/lib/i18n/provider";
import { filterNav } from "@/lib/permissions";

/** Shown once, right after onboarding: a short welcome and the features this plan includes. */
export function WelcomeCard() {
  const { t } = useI18n();
  const { client, permissions } = useActiveClient();
  const [open, setOpen] = useState(true);
  if (!open) return null;
  const features = filterNav(USER_NAV, permissions).filter((item) => item.href !== "/dashboard");

  return (
    <section className="relative mb-8 overflow-hidden rounded-panel border border-border">
      <div className="h-1 bg-ig-gradient" aria-hidden="true" />
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="absolute end-3 top-4 rounded-pill p-1 text-muted hover:bg-hover hover:text-foreground"
        aria-label={t("common.dismiss")}
      >
        <X className="size-4" />
      </button>
      <div className="p-5 pe-12">
        <div className="flex items-center gap-2">
          <PartyPopper className="size-5 text-ig-pink" aria-hidden="true" />
          <h2 className="text-title font-bold">{t("welcome.title", { name: client.businessName })}</h2>
        </div>
        <p className="mt-1 text-body text-muted">{t("welcome.body")}</p>
        <p className="mt-4 mb-2 text-caption font-semibold text-muted">{t("welcome.features")}</p>
        <ul className="flex flex-wrap gap-2">
          {features.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="inline-flex h-9 items-center gap-2 rounded-button border border-border px-3 text-body font-semibold hover:bg-hover">
                <NavIcon name={item.icon} className="size-[18px]" />
                {t(item.labelKey)}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Reminder for businesses that skipped "Connect Instagram" in onboarding (or disconnected later). */
export function ConnectInstagramReminder() {
  const { t } = useI18n();
  const { client, isPreview } = useActiveClient();
  if (isPreview || client.connection !== "disconnected") return null;
  return (
    <section className="mb-8 flex flex-wrap items-center gap-4 rounded-panel border border-border p-4">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-pill border-2 border-foreground">
        <Camera className="size-6" strokeWidth={1.5} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-body font-semibold">{t("welcome.connectTitle")}</p>
        <p className="text-caption text-muted">{t("welcome.connectBody")}</p>
      </div>
      <Button asChild>
        <Link href="/settings#instagram">{t("settings.instagram.connect")}</Link>
      </Button>
    </section>
  );
}
