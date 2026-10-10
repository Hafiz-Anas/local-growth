"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, RefreshCw, Sparkles } from "lucide-react";
import { BrandContextView } from "@/components/brand/brand-context-view";
import { BrandPostDialog } from "@/components/brand/brand-post-dialog";
import { BrandPostGrid } from "@/components/brand/brand-post-grid";
import { LogoCard } from "@/components/brand/logo-card";
import { useActiveClient } from "@/components/providers/active-client-provider";
import { EmptyState, ErrorState, Skeleton } from "@/components/shared/states";
import { TimeAgo } from "@/components/shared/time-ago";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { MAX_BRAND_POSTS, type InstagramLanguage } from "@/config/onboarding";
import { useBrandProfileCache, useRefreshBrand } from "@/lib/api/brand";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { qk, useBrandProfile } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { notify } from "@/store/ui-store";
import type { BrandBasicsDto, BrandContextDto, BrandContextPatch, BrandPostDto, BrandProfileDto } from "@/types";
import { Segmented } from "./segmented";

/**
 * Settings → Brand profile: what the AI learned (editable), the example posts
 * (add, replace, change purpose), the posting language and "Rebuild", which
 * saves a new version.
 * Read-only while an admin previews the business.
 */
export function BrandProfileSection() {
  const { t } = useI18n();
  const { client, isPreview } = useActiveClient();
  const profile = useBrandProfile();
  const queryClient = useQueryClient();
  const refresh = useRefreshBrand();
  const updateCache = useBrandProfileCache();
  const [editing, setEditing] = useState<{ post: BrandPostDto | null; slot: number } | null>(null);
  const [confirmRebuild, setConfirmRebuild] = useState(false);

  const setContext = (context: BrandContextDto) =>
    updateCache((p) => ({
      ...p,
      context,
      versions: [{ version: context.version, status: context.status, editedByUser: context.editedByUser, createdAt: context.createdAt }, ...p.versions.filter((v) => v.version !== context.version)],
    }));

  const edit = useMutation<BrandContextDto, ApiClientError, BrandContextPatch>({
    mutationFn: (patch) => apiFetch("/api/brand/context", { method: "PATCH", body: patch }),
    onSuccess: (context) => {
      setContext(context);
      refresh();
      notify.success(t("brand.context.saved"));
    },
  });
  const build = useMutation<BrandContextDto, ApiClientError>({
    meta: { handlesErrors: true },
    mutationFn: () => apiFetch("/api/brand/context", { method: "POST" }),
    onSuccess: (context) => {
      setContext(context);
      refresh();
      notify.success(t("brand.profile.rebuilt", { version: context.version }));
    },
    onError: (e) => {
      notify.error(e.code === "ai_error" ? t("onboarding.review.failedBody") : errorMessage(e, t));
      // A failed build is stored as a version; show it.
      queryClient.invalidateQueries({ queryKey: qk.brand });
    },
  });

  if (profile.isPending) return <Skeleton className="h-96 rounded-panel" />;
  if (profile.isError) return <ErrorState error={profile.error} onRetry={() => profile.refetch()} />;
  const data: BrandProfileDto = profile.data;
  const { context, posts } = data;
  const latest = data.versions[0];
  const failedLatest = latest && latest.status === "failed" && (!context || latest.version > context.version);

  return (
    <section id="brand-profile" className="scroll-mt-[calc(var(--topbar-height)+16px)] space-y-4" aria-labelledby="brand-profile-title">
      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle id="brand-profile-title">{t("brand.profile.title")}</CardTitle>
            <CardDescription>
              {context ? (
                <>
                  {t("brand.profile.version", { version: context.version })}
                  {context.editedByUser && ` · ${t("brand.profile.edited")}`} · <TimeAgo iso={context.updatedAt} />
                </>
              ) : (
                t("brand.profile.hint")
              )}
            </CardDescription>
          </div>
          {!isPreview && context && (
            <Button variant="secondary" onClick={() => setConfirmRebuild(true)} disabled={build.isPending || posts.length === 0}>
              {build.isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {t("brand.profile.rebuild")}
            </Button>
          )}
        </CardHeader>
        {failedLatest && (
          <p className="mx-4 mb-4 rounded-card bg-danger/8 px-3 py-2 text-caption text-danger">{t("brand.profile.lastFailed", { version: latest.version })}</p>
        )}
        {!context && (
          <EmptyState
            icon={Sparkles}
            title={t("brand.profile.emptyTitle")}
            hint={posts.length ? t("brand.profile.emptyHintReady") : t("brand.profile.emptyHint")}
            action={
              !isPreview && (
                <Button onClick={() => build.mutate()} disabled={build.isPending || posts.length === 0}>
                  {build.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {t("onboarding.review.build")}
                </Button>
              )
            }
            className="pt-2"
          />
        )}
      </Card>

      {context && (
        <div className={build.isPending ? "pointer-events-none opacity-50" : undefined}>
          <BrandContextView context={context} readOnly={isPreview} onSave={(patch) => edit.mutateAsync(patch)} />
        </div>
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t("brand.posts.title")}</CardTitle>
            <CardDescription>{t("brand.posts.hint", { max: MAX_BRAND_POSTS })}</CardDescription>
          </div>
          <Badge variant="neutral">
            {posts.length}/{MAX_BRAND_POSTS}
          </Badge>
        </CardHeader>
        <div className="px-4 pb-4">
          {posts.length === 0 ? (
            <p className="rounded-card bg-secondary-bg px-4 py-8 text-center text-body text-muted">{t("brand.posts.empty")}</p>
          ) : (
            <BrandPostGrid posts={posts} onSelect={isPreview ? undefined : (post) => setEditing({ post, slot: posts.indexOf(post) + 1 })} />
          )}
          {!isPreview && posts.length < MAX_BRAND_POSTS && (
            <Button variant="secondary" className="mt-3" onClick={() => setEditing({ post: null, slot: posts.length + 1 })}>
              <Plus className="size-4" />
              {t("brand.posts.add")}
            </Button>
          )}
          {context && !isPreview && <p className="mt-3 text-caption text-muted">{t("brand.posts.rebuildHint")}</p>}
        </div>
      </Card>

      <LogoCard logoUrl={data.basics.logoUrl} readOnly={isPreview} eventStep={null} />

      <PostingLanguageCard languages={data.basics.languages} readOnly={isPreview} />

      {!isPreview && (
        <BrandPostDialog
          open={editing !== null}
          onOpenChange={(open) => !open && setEditing(null)}
          post={editing?.post ?? null}
          slot={editing?.slot ?? 1}
          connected={client.connection !== "disconnected"}
          usedMediaIds={posts.map((p) => p.igMediaId).filter((id): id is string => Boolean(id))}
          onSaved={(saved) => {
            updateCache((p) => ({ ...p, posts: p.posts.some((x) => x.id === saved.id) ? p.posts.map((x) => (x.id === saved.id ? saved : x)) : [...p.posts, saved] }));
            refresh();
          }}
          onRemoved={(id) => {
            updateCache((p) => ({ ...p, posts: p.posts.filter((x) => x.id !== id) }));
            refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={confirmRebuild}
        onOpenChange={setConfirmRebuild}
        title={t("brand.profile.rebuildTitle")}
        description={t("brand.profile.rebuildBody")}
        confirmLabel={t("brand.profile.rebuild")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => build.mutate()}
      />
    </section>
  );
}

type LanguageChoice = InstagramLanguage | "both";

/**
 * The language(s) captions are written in. Onboarding learns it from the posts'
 * captions instead of asking; it can be corrected here. Rebuilds use this value.
 */
function PostingLanguageCard({ languages, readOnly }: { languages: InstagramLanguage[]; readOnly: boolean }) {
  const { t } = useI18n();
  const refresh = useRefreshBrand();
  const updateCache = useBrandProfileCache();
  const current: LanguageChoice = languages.length === 1 ? languages[0] : "both";

  const save = useMutation<BrandBasicsDto, ApiClientError, LanguageChoice, InstagramLanguage[]>({
    mutationFn: (choice) => apiFetch("/api/brand/basics", { method: "PUT", body: { languages: choice === "both" ? ["ar", "en"] : [choice] } }),
    onMutate: (choice) => {
      updateCache((p) => ({ ...p, basics: { ...p.basics, languages: choice === "both" ? ["ar", "en"] : [choice] } }));
      return languages;
    },
    onSuccess: () => {
      refresh();
      notify.success(t("brand.language.saved"));
    },
    onError: (_error, _choice, previous) => {
      if (previous) updateCache((p) => ({ ...p, basics: { ...p.basics, languages: previous } }));
    },
  });

  const options: Array<{ value: LanguageChoice; label: string }> = [
    { value: "ar", label: t("brand.language.ar") },
    { value: "en", label: t("brand.language.en") },
    { value: "both", label: t("brand.language.both") },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{t("brand.language.title")}</CardTitle>
          <CardDescription>{t("brand.language.hint")}</CardDescription>
        </div>
      </CardHeader>
      <div className="px-4 pb-4">
        {readOnly ? (
          <p className="text-body">{options.find((o) => o.value === current)?.label}</p>
        ) : (
          <Segmented<LanguageChoice> value={current} options={options} onChange={(choice) => choice !== current && save.mutate(choice)} label={t("brand.language.title")} />
        )}
      </div>
    </Card>
  );
}
