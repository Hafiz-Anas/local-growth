"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Palette, Pencil, RefreshCw, Sparkles, CalendarPlus, X } from "lucide-react";
import { WINDOW_START_HOUR } from "@/config/schedule";
import { useActiveClient, useFeature } from "@/components/providers/active-client-provider";
import { PageHeader } from "@/components/shared/page-header";
import { PostPreview } from "@/components/shared/post-preview";
import { ErrorState, Skeleton } from "@/components/shared/states";
import { TagInput } from "@/components/shared/tag-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api/client";
import { qk, useAction, useDrafts, useGeneratorOptions, useScheduled } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { nextSlot } from "@/lib/time";
import { cn, formatDateTime } from "@/lib/utils";
import { notify } from "@/store/ui-store";
import type { PostDraftDto, PostWindow, ScheduledPostDto } from "@/types";
import { DraftImageOverlay, DraftImageToolbar, useDraftImages } from "./draft-image";

/** The AI puts hashtags in a final paragraph; show them like Instagram does, under the caption. */
function splitHashtags(caption: string): { text: string; hashtags: string[] } {
  const parts = caption.trimEnd().split(/\n\s*\n/);
  const last = parts.at(-1)?.trim() ?? "";
  if (parts.length > 1 && last.split(/\s+/).every((w) => w.startsWith("#"))) {
    return {
      text: parts.slice(0, -1).join("\n\n"),
      hashtags: last.split(/\s+/),
    };
  }
  return { text: caption, hashtags: [] };
}

/** The window most upcoming posts use (e.g. after "Apply to schedule"), else evening. */
function preferredWindow(queue: ScheduledPostDto[]): PostWindow {
  const counts = new Map<PostWindow, number>();
  for (const post of queue) counts.set(post.window, (counts.get(post.window) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "evening";
}

export function PostGeneratorView() {
  const { client } = useActiveClient();
  const { t, locale } = useI18n();
  const canVocab = useFeature("postGenerator.brandVocabulary");
  const canRegenerate = useFeature("postGenerator.regenerate");
  const canQueue = useFeature("postGenerator.addToQueue");
  const queryClient = useQueryClient();

  const options = useGeneratorOptions();
  const drafts = useDrafts();
  const queue = useScheduled(canQueue);

  const [categoryChoice, setCategoryChoice] = useState<string | null>(null);
  const [occasionChoice, setOccasionChoice] = useState<string | null>(null);
  const [vocabularyEdit, setVocabularyEdit] = useState<string[] | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const replaceDraft = (draft: PostDraftDto) => queryClient.setQueryData<PostDraftDto[]>(qk.drafts, (list) => list?.map((d) => (d.id === draft.id ? draft : d)));
  const images = useDraftImages((draft) => {
    replaceDraft(draft);
    // A queued post carries the draft's image.
    if (draft.status === "queued") queryClient.invalidateQueries({ queryKey: qk.scheduled });
  });

  const generate = useAction({
    mutationFn: (body: { categoryId: string; occasionId: string; vocabulary?: string[] }) =>
      apiFetch<PostDraftDto[]>("/api/post-drafts/generate", {
        method: "POST",
        body,
      }),
    onSuccess: (created) => {
      queryClient.setQueryData<PostDraftDto[]>(qk.drafts, (list) => [...created, ...(list ?? [])]);
      setEditing(null);
    },
  });
  const saveEdit = useAction({
    mutationFn: ({ id, caption }: { id: string; caption: string }) =>
      apiFetch<PostDraftDto>(`/api/post-drafts/${id}`, {
        method: "PATCH",
        body: { caption },
      }),
    onSuccess: (draft) => {
      replaceDraft(draft);
      setEditing(null);
    },
  });
  const regenerate = useAction({
    mutationFn: (id: string) =>
      apiFetch<PostDraftDto>(`/api/post-drafts/${id}/regenerate`, {
        method: "POST",
      }),
    onMutate: (id) => setBusyId(id),
    onSuccess: replaceDraft,
    onSettled: () => setBusyId(null),
  });
  const reject = useAction({
    mutationFn: (id: string) => apiFetch(`/api/post-drafts/${id}/reject`, { method: "POST" }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: qk.drafts });
      const previous = queryClient.getQueryData<PostDraftDto[]>(qk.drafts);
      queryClient.setQueryData<PostDraftDto[]>(qk.drafts, (list) => list?.filter((d) => d.id !== id));
      return { previous };
    },
    onError: (_e, _id, context) => queryClient.setQueryData(qk.drafts, context?.previous),
  });
  const addToQueue = useAction({
    mutationFn: ({ id, scheduledFor }: { id: string; scheduledFor: string }) =>
      apiFetch<ScheduledPostDto>(`/api/post-drafts/${id}/queue`, {
        method: "POST",
        body: { scheduledFor },
      }),
    onSuccess: (post, { id }) => {
      queryClient.setQueryData<PostDraftDto[]>(qk.drafts, (list) => list?.map((d) => (d.id === id ? { ...d, status: "queued" } : d)));
      queryClient.setQueryData<ScheduledPostDto[]>(qk.scheduled, (list) => [...(list ?? []), post].sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor)));
      queryClient.invalidateQueries({ queryKey: qk.experiment });
      notify.success(
        t("generator.queuedFor", {
          time: formatDateTime(post.scheduledFor, locale, {
            weekday: "short",
            day: "numeric",
            month: "short",
            hour: "numeric",
            minute: "2-digit",
          }),
        }),
      );
    },
  });

  if (options.isPending) return <GeneratorSkeleton />;
  if (options.isError) return <ErrorState error={options.error} onRetry={() => options.refetch()} />;

  const data = options.data!;
  // Pre-filled from the brand profile: the purpose the business's example posts use most.
  const categoryId = categoryChoice ?? data.defaults.categoryId ?? data.categories[0]?.id ?? "";
  const occasionId = occasionChoice ?? data.defaults.occasionId ?? data.occasions[0]?.id ?? "";
  const brandPurposes = new Set<string>(data.brandContext?.purposes ?? []);
  const vocabulary = vocabularyEdit ?? data.brandVocabulary;
  const visible = (drafts.data ?? []).filter((d) => d.status === "draft" || d.status === "queued");

  function queueDraft(draft: PostDraftDto) {
    const upcoming = queue.data ?? [];
    const window = preferredWindow(upcoming);
    addToQueue.mutate({
      id: draft.id,
      scheduledFor: nextSlot(upcoming, window, WINDOW_START_HOUR[window], client.timezone),
    });
  }

  return (
    <div>
      <PageHeader title={t("generator.title")} subtitle={t("generator.subtitle")} />
      {client.instagramProvider === "meta" && <p className="-mt-2 mb-4 rounded-card bg-secondary-bg px-3 py-2 text-caption text-muted">{t("instagramConnect.notes.publishing")}</p>}

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card className="h-fit lg:sticky lg:top-[calc(var(--topbar-height)+24px)]">
          <CardContent className="space-y-6 pt-4">
            <ChipGroup
              label={t("generator.category")}
              options={data.categories.map((c) => ({
                id: c.id,
                label: locale === "ar" ? c.labelAr : c.label,
              }))}
              value={categoryId}
              onChange={setCategoryChoice}
            />
            <ChipGroup
              label={t("generator.occasion")}
              hint={brandPurposes.size > 0 ? t("generator.occasionFromBrand") : undefined}
              options={data.occasions.map((o) => ({
                id: o.id,
                label: locale === "ar" ? o.labelAr : o.label,
                marked: brandPurposes.has(o.id),
              }))}
              value={occasionId}
              onChange={setOccasionChoice}
            />
            {canVocab && (
              <div>
                <p className="text-body font-semibold">{t("generator.vocabulary")}</p>
                <p className="mb-3 text-caption text-muted">{t("generator.vocabularyHint")}</p>
                <TagInput values={vocabulary} onChange={setVocabularyEdit} placeholder={t("generator.wordPlaceholder")} addLabel={t("generator.addWord")} />
              </div>
            )}
            <Button
              className="w-full"
              size="md"
              onClick={() =>
                generate.mutate({
                  categoryId,
                  occasionId,
                  ...(canVocab && { vocabulary }),
                })
              }
              disabled={generate.isPending || !categoryId || !occasionId}
            >
              {generate.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {t("generator.generate")}
            </Button>
          </CardContent>
        </Card>

        <section aria-live="polite">
          {data.brandContext && (
            <div className="mb-3 flex items-start gap-2.5 rounded-card bg-secondary-bg px-3 py-2.5">
              <Palette className="mt-px size-4 shrink-0 text-ig-pink" aria-hidden="true" />
              <p className="min-w-0 flex-1 text-caption">
                <span className="font-semibold">
                  {t("generator.brandProfile", {
                    version: data.brandContext.version,
                  })}
                </span>{" "}
                <span className="line-clamp-2 text-muted" dir="auto">
                  {data.brandContext.summary}
                </span>
              </p>
              <Link href="/settings#brand-profile" className="shrink-0 text-caption font-semibold text-primary hover:text-link">
                {t("generator.brandProfileEdit")}
              </Link>
            </div>
          )}
          <div className="mb-4 flex items-start gap-2.5 rounded-card border border-border px-3 py-2.5">
            <Sparkles className="mt-px size-4 shrink-0 text-ig-purple" aria-hidden="true" />
            <p className="text-caption">
              <span className="font-semibold">{t("common.aiGenerated")}</span> · {t("generator.aiNotice")}
              {data.imageProvider === "mock" && <span className="mt-0.5 block text-muted">{t("generator.image.mockNote")}</span>}
            </p>
          </div>
          {images.fileInput}

          {(drafts.isPending || (generate.isPending && visible.length === 0)) && <DraftSkeletons />}
          {drafts.isError && <ErrorState error={drafts.error} onRetry={() => drafts.refetch()} />}

          {drafts.isSuccess && !generate.isPending && visible.length === 0 && (
            <div className="flex flex-col items-center rounded-card border border-dashed border-border px-6 py-16 text-center">
              <span className="mb-3 flex size-16 items-center justify-center rounded-pill border-2 border-foreground">
                <Sparkles className="size-7" strokeWidth={1.5} />
              </span>
              <p className="text-body text-muted">{t("generator.empty")}</p>
            </div>
          )}

          {visible.length > 0 && (
            <div className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-2", generate.isPending && "opacity-50")}>
              {visible.map((draft) => {
                const isEditing = editing?.id === draft.id;
                const isQueued = draft.status === "queued";
                const { text, hashtags } = splitHashtags(draft.caption);
                return (
                  <PostPreview
                    key={draft.id}
                    handle={client.handle}
                    location={locale === "ar" ? client.locationAr : client.location}
                    avatarUrl={client.avatarUrl}
                    avatarInitials={client.avatarInitials}
                    avatarTone={client.avatarTone}
                    mediaTone={draft.tone}
                    mediaIcon={draft.icon}
                    mediaSrc={draft.image?.url}
                    mediaAlt={draft.image ? (draft.image.source === "generated" ? t("generator.image.altGenerated") : t("generator.image.altUploaded")) : undefined}
                    mediaOverlay={<DraftImageOverlay draft={draft} images={images} />}
                    caption={text}
                    hashtags={hashtags}
                    likesLabel={t("generator.likedBy", { name: "fajer.q8" })}
                    timeLabel={`${t("common.aiGenerated")} · ${draft.language === "ar" ? t("generator.arabic") : t("generator.english")}`}
                    mediaBadge={
                      // The caption badge belongs on the placeholder only; a real image gets its own label (or none if uploaded).
                      !draft.image && (
                        <span className="inline-flex items-center gap-1 rounded-pill bg-black/60 px-2 py-1 text-[11px] font-semibold text-white">
                          <Sparkles className="size-3" /> {t("common.aiGenerated")}
                        </span>
                      )
                    }
                    captionSlot={
                      isEditing ? (
                        <div className="space-y-2">
                          <Textarea value={editing.text} onChange={(e) => setEditing({ id: draft.id, text: e.target.value })} rows={5} dir="auto" autoFocus />
                          <div className="flex justify-end gap-2">
                            <Button variant="secondary" onClick={() => setEditing(null)}>
                              {t("common.cancel")}
                            </Button>
                            <Button
                              onClick={() =>
                                saveEdit.mutate({
                                  id: draft.id,
                                  caption: editing.text,
                                })
                              }
                              disabled={!editing.text.trim() || saveEdit.isPending}
                            >
                              {saveEdit.isPending && <Loader2 className="size-4 animate-spin" />}
                              {t("common.save")}
                            </Button>
                          </div>
                        </div>
                      ) : undefined
                    }
                    footer={
                      <>
                        <DraftImageToolbar draft={draft} images={images} disabled={isEditing} />
                        <div className="flex divide-x divide-separator rtl:divide-x-reverse border-t border-separator">
                          <FooterAction icon={Pencil} label={t("common.edit")} onClick={() => setEditing({ id: draft.id, text: draft.caption })} disabled={isEditing} />
                          {canRegenerate && !isQueued && (
                            <FooterAction
                              icon={busyId === draft.id ? Loader2 : RefreshCw}
                              spin={busyId === draft.id}
                              label={t("generator.regenerate")}
                              onClick={() => regenerate.mutate(draft.id)}
                              disabled={busyId === draft.id || isEditing}
                            />
                          )}
                          {!isQueued && <FooterAction icon={X} label={t("generator.discard")} onClick={() => reject.mutate(draft.id)} disabled={isEditing} />}
                          {canQueue && (
                            <FooterAction
                              icon={isQueued ? Check : CalendarPlus}
                              label={isQueued ? t("generator.addedToQueue") : t("generator.addToQueue")}
                              onClick={() => queueDraft(draft)}
                              disabled={isQueued || isEditing || (addToQueue.isPending && addToQueue.variables?.id === draft.id)}
                              primary
                            />
                          )}
                        </div>
                      </>
                    }
                  />
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ChipGroup({
  label,
  hint,
  options,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  /** `marked` options get a small dot (e.g. purposes the business's own posts use). */
  options: Array<{ id: string; label: string; marked?: boolean }>;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <fieldset>
      <legend className={cn("text-body font-semibold", hint ? "mb-0.5" : "mb-2.5")}>{label}</legend>
      {hint && <p className="mb-2.5 text-caption text-muted">{hint}</p>}
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const selected = o.id === value;
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(o.id)}
              className={cn(
                "h-8 rounded-button px-3 text-body font-semibold transition-colors",
                selected ? "bg-foreground text-background" : "bg-button-secondary text-foreground hover:bg-button-secondary-hover",
                o.marked && "inline-flex items-center gap-1.5",
              )}
            >
              {o.marked && <span className="size-1.5 rounded-pill bg-ig-gradient" aria-hidden="true" />}
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function FooterAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  primary,
  spin,
}: {
  icon: typeof Pencil;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  spin?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1.5 py-2 text-[11px] leading-3 font-semibold transition-colors hover:bg-hover disabled:opacity-60",
        primary ? "text-primary" : "text-foreground",
      )}
    >
      <Icon className={cn("size-4 shrink-0", spin && "animate-spin")} aria-hidden="true" />
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}

function GeneratorSkeleton() {
  return (
    <div aria-busy="true">
      <div className="mb-6 space-y-2.5">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-4 rounded-panel border border-border p-4">
          {[0, 1].map((i) => (
            <div key={i} className="space-y-2.5">
              <Skeleton className="h-4 w-32" />
              <div className="flex flex-wrap gap-2">
                {[0, 1, 2].map((j) => (
                  <Skeleton key={j} className="h-8 w-24" />
                ))}
              </div>
            </div>
          ))}
          <Skeleton className="h-10 w-full" />
        </div>
        <DraftSkeletons />
      </div>
    </div>
  );
}

function DraftSkeletons() {
  return (
    <div className="grid gap-4 sm:grid-cols-2" aria-hidden="true">
      {[0, 1].map((i) => (
        <div key={i} className="animate-pulse overflow-hidden rounded-card border border-border">
          <div className="flex items-center gap-2.5 p-3">
            <div className="size-8 rounded-pill bg-button-secondary" />
            <div className="h-3 w-28 rounded bg-button-secondary" />
          </div>
          <div className="aspect-square bg-button-secondary" />
          <div className="space-y-2 p-3">
            <div className="h-3 w-full rounded bg-button-secondary" />
            <div className="h-3 w-2/3 rounded bg-button-secondary" />
          </div>
        </div>
      ))}
    </div>
  );
}
