"use client";

import Link from "next/link";
import { Avatar } from "@/components/shared/avatar";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";
import { formatCompact } from "@/lib/utils";
import type { Client } from "@/types";

/** Instagram profile header: avatar with story ring, handle, counts, name, bio. */
export function ProfileHeader({ client }: { client: Client }) {
  const { t, locale } = useI18n();
  const stats = [
    { value: client.posts, label: t("common.posts") },
    { value: client.followers, label: t("common.followers") },
    { value: client.following, label: t("common.following") },
  ];

  return (
    <section className="mb-8 border-b border-border pb-8">
      <div className="flex items-center gap-6 md:items-start md:gap-20 md:px-8">
        <Avatar src={client.avatarUrl} alt={client.handle} initials={client.avatarInitials} tone={client.avatarTone} size="xl" ring="story" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 md:gap-3">
            <h1 className="me-2 truncate text-heading font-normal">{client.handle}</h1>
            <div className="flex gap-2">
              {client.instagramHandle !== null && (
                <Button variant="secondary" size="sm" asChild>
                  <a href={`https://instagram.com/${client.handle}`} target="_blank" rel="noreferrer">
                    {t("dashboard.viewOnInstagram")}
                  </a>
                </Button>
              )}
              <Button variant="secondary" size="sm" asChild>
                <Link href="/settings">{t("dashboard.editSettings")}</Link>
              </Button>
            </div>
          </div>

          <ul className="mt-5 hidden gap-10 text-title md:flex">
            {stats.map((s) => (
              <li key={s.label}>
                <span className="font-semibold">{formatCompact(s.value, locale)}</span> {s.label}
              </li>
            ))}
          </ul>

          <div className="mt-5 hidden md:block">
            <ProfileBio client={client} />
          </div>
        </div>
      </div>

      <div className="mt-4 md:hidden">
        <ProfileBio client={client} />
        <ul className="mt-4 grid grid-cols-3 border-t border-border pt-3 text-center">
          {stats.map((s) => (
            <li key={s.label} className="text-body">
              <span className="block font-semibold">{formatCompact(s.value, locale)}</span>
              <span className="text-muted">{s.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ProfileBio({ client }: { client: Client }) {
  const { locale } = useI18n();
  return (
    <div className="text-body">
      <p className="font-semibold">{locale === "ar" ? client.businessNameAr : client.businessName}</p>
      <p className="text-muted">{locale === "ar" ? client.categoryAr : client.category}</p>
      <p className="whitespace-pre-line" dir="auto">
        {client.bio}
      </p>
      <p className="font-semibold text-link">{client.website}</p>
    </div>
  );
}
