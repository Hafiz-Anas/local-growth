"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { insights as mockInsights } from "@/mock-data/gallery/insights";
import type { AccountId, Insights, L, Photo, PostType } from "@/mock-data/gallery/types";
import { useI18n } from "@/lib/i18n/provider";
import { translate, type MessageKey } from "./i18n";
import { useStore } from "./store";

/** The proposal's translation hook, reading the app's language (locales/*.json → galleryAi). */
export function useT() {
  const lang = useI18n().locale;
  const t = useCallback((key: MessageKey, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);
  const l = useCallback((text: L | undefined) => (text ? text[lang] : ""), [lang]);
  return { t, l, lang, dir: lang === "ar" ? ("rtl" as const) : ("ltr" as const) };
}

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");

export function useMounted() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/** Full insights for the active account: static mock numbers plus figures derived from its photos. */
export function useInsights(): Insights {
  const accountId = useStore((s) => s.activeAccountId) as AccountId;
  const photos = useStore((s) => s.photos[s.activeAccountId]);
  const lastRun = useStore((s) => s.lastAnalysis[s.activeAccountId]);
  return useMemo(() => {
    const base = mockInsights[accountId] ?? mockInsights.mathanet;
    return { ...base, ...derive(photos), lastAnalysis: lastRun ?? base.lastAnalysis };
  }, [accountId, photos, lastRun]);
}

const engagementOf = (p: Photo) =>
  p.metrics && p.metrics.reach > 0 ? ((p.metrics.likes + p.metrics.comments + p.metrics.saves) / p.metrics.reach) * 100 : 0;

function derive(photos: Photo[]) {
  const published = photos.filter((p) => p.status === "published" && p.metrics && p.metrics.likes > 0);
  const types: PostType[] = ["reel", "carousel", "photo"];
  const avg = (list: Photo[], f: (p: Photo) => number) => (list.length ? list.reduce((s, p) => s + f(p), 0) / list.length : 0);
  const promotedPosts = published.filter((p) => p.promoted);
  const organicPosts = published.filter((p) => !p.promoted);
  return {
    contentTypes: types.map((type) => {
      const list = published.filter((p) => p.postType === type);
      return { type, engagement: avg(list, engagementOf), posts: list.length };
    }),
    promoted: { reach: avg(promotedPosts, (p) => p.metrics!.reach), engagement: avg(promotedPosts, engagementOf), posts: promotedPosts.length },
    organic: { reach: avg(organicPosts, (p) => p.metrics!.reach), engagement: avg(organicPosts, engagementOf), posts: organicPosts.length },
  };
}

export { engagementOf };
