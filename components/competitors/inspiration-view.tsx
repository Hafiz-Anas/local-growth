"use client";

import Link from "next/link";
import { Bookmark, Heart, MessageCircle } from "lucide-react";
import { useFeature } from "@/components/providers/active-client-provider";
import { Avatar } from "@/components/shared/avatar";
import { MediaPlaceholder } from "@/components/shared/media";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/gallery/store";
import { useI18n } from "@/lib/i18n/provider";
import { formatCompact, initials, toneFor } from "@/lib/utils";

/**
 * Competitors → Inspiration: competitor posts saved from the viewer ("Save as inspiration"), newest
 * first, each labelled with the competitor. Tapping one opens the same viewer with the same two
 * actions. Saved posts live in the Gallery's store (lib/gallery/store.ts) and this browser's
 * localStorage, one list per business, so they survive a reload (never sent to the server); they
 * never join the owner's albums or Favourites.
 */
export function InspirationView() {
  const { t, locale } = useI18n();
  const saved = useStore((s) => s.inspiration);
  const showAccounts = useFeature("competitors.accounts");

  return (
    <div>
      <PageHeader title={t("competitors.inspiration.title")} subtitle={t("competitors.inspiration.subtitle")} />

      {saved.length === 0 ? (
        <EmptyState
          icon={Bookmark}
          title={t("competitors.inspiration.emptyTitle")}
          hint={t("competitors.inspiration.emptyHint")}
          className="rounded-panel border border-dashed border-border"
          action={
            showAccounts && (
              <Button variant="secondary" asChild>
                <Link href="/competitors">{t("competitors.inspiration.browse")}</Link>
              </Button>
            )
          }
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="inspiration-grid">
          {saved.map((item, i) => (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => useStore.getState().openCompetitorViewer(saved, i)}
                className="group block w-full overflow-hidden rounded-card border border-border text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                data-testid="inspiration-item"
              >
                <MediaPlaceholder tone={item.post.tone} icon={item.post.icon} src={item.post.mediaUrl} className="aspect-square w-full transition-opacity group-hover:opacity-90" iconClassName="size-1/3">
                  <span className="absolute end-2 top-2 flex size-7 items-center justify-center rounded-pill bg-black/45 text-white">
                    <Bookmark className="size-3.5 fill-white" aria-hidden="true" />
                  </span>
                  <span className="absolute inset-x-0 bottom-0 flex gap-3 bg-gradient-to-t from-black/65 to-transparent px-2 pt-6 pb-1.5 text-caption font-semibold text-white">
                    <span className="flex items-center gap-1">
                      <Heart className="size-3.5 fill-white" aria-hidden="true" />
                      <span className="sr-only">{t("common.likes", { count: item.post.likes })}</span>
                      <span aria-hidden="true">{formatCompact(item.post.likes, locale)}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageCircle className="size-3.5 fill-white rtl:-scale-x-100" aria-hidden="true" />
                      <span className="sr-only">{t("common.comments", { count: item.post.comments })}</span>
                      <span aria-hidden="true">{formatCompact(item.post.comments, locale)}</span>
                    </span>
                  </span>
                </MediaPlaceholder>
                <span className="flex items-center gap-2 px-2.5 py-2">
                  <Avatar src={item.avatarUrl} alt={item.handle} initials={initials(item.name)} tone={toneFor(item.handle)} size="xs" />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-caption font-semibold" dir="auto">
                      {item.name}
                    </span>
                    <span className="block truncate text-caption text-muted">
                      <bdi dir="ltr">@{item.handle}</bdi>
                    </span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
