"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BrandPostDialog } from "@/components/brand/brand-post-dialog";
import { BrandPostGrid } from "@/components/brand/brand-post-grid";
import { Button } from "@/components/ui/button";
import { ONBOARDING_POST_SLOTS } from "@/config/onboarding";
import { qk } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import type { BrandPostDto, OnboardingStateDto } from "@/types";
import { StepFrame } from "../step-frame";
import { useWizard } from "../wizard-context";

/** Step 4 — Your posts: five examples, each with what it's for. Can be skipped (added later in Settings). */
export function StepPosts() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { state, go, moving } = useWizard();
  const [editing, setEditing] = useState<{ post: BrandPostDto | null; slot: number } | null>(null);

  const posts = state.posts;
  const missing = ONBOARDING_POST_SLOTS - posts.length;
  const connected = state.instagram.status !== "disconnected";
  const setPosts = (update: (posts: BrandPostDto[]) => BrandPostDto[]) =>
    queryClient.setQueryData<OnboardingStateDto>(qk.onboarding, (s) => s && { ...s, posts: update(s.posts).sort((a, b) => a.order - b.order) });

  return (
    <StepFrame
      step="posts"
      title={t("onboarding.steps.posts.title", { count: ONBOARDING_POST_SLOTS })}
      helper={t("onboarding.steps.posts.helper")}
      onBack={() => go("competitors", "back")}
      primary={{ label: t("onboarding.continue"), onClick: () => go("brand", "forward"), disabled: missing > 0, busy: moving }}
      secondary={
        missing > 0 && (
          <Button variant="ghost" size="md" onClick={() => go("brand", "forward", { skipped: true, posts: posts.length })} disabled={moving}>
            {t("onboarding.posts.skip")}
          </Button>
        )
      }
      blockedNote={missing > 0 ? t("onboarding.posts.needMore", { count: missing }) : null}
      reportContext={{ posts: posts.length, connected, sources: posts.map((p) => `${p.source}:${p.mediaType}`) }}
    >
      <BrandPostGrid
        posts={posts}
        slots={ONBOARDING_POST_SLOTS}
        onSelect={(post) => setEditing({ post, slot: posts.indexOf(post) + 1 })}
        onAdd={() => setEditing({ post: null, slot: posts.length + 1 })}
        className="mx-auto max-w-[520px]"
      />
      <p className="mt-4 text-center text-caption text-muted">{t("onboarding.posts.hint")}</p>

      <BrandPostDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        post={editing?.post ?? null}
        slot={editing?.slot ?? 1}
        connected={connected}
        usedMediaIds={posts.map((p) => p.igMediaId).filter((id): id is string => Boolean(id))}
        eventStep="posts"
        onSaved={(saved) => {
          setPosts((list) => (list.some((p) => p.id === saved.id) ? list.map((p) => (p.id === saved.id ? saved : p)) : [...list, saved]));
          queryClient.invalidateQueries({ queryKey: qk.brandColors });
        }}
        onRemoved={(id) => {
          setPosts((list) => list.filter((p) => p.id !== id));
          queryClient.invalidateQueries({ queryKey: qk.brandColors });
        }}
      />
    </StepFrame>
  );
}
