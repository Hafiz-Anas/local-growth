"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BarChart3, ChevronDown, History, Loader2, PenLine, Plus, Send, Sparkles, Trash2, Users } from "lucide-react";
import { useActiveClient } from "@/components/providers/active-client-provider";
import { ChipSelect } from "@/components/shared/chip-select";
import { EmptyState, ErrorState, Skeleton } from "@/components/shared/states";
import { TimeAgo } from "@/components/shared/time-ago";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { qk, useAction, useAssistant, useAssistantThread } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { AssistantMessageDto, AssistantModeKey, AssistantOverviewDto, AssistantReplyDto, AssistantThreadDto } from "@/types";

const MODE_ICONS = { post: PenLine, analytics: BarChart3, competitors: Users } satisfies Record<AssistantModeKey, unknown>;
const MAX_QUESTION = 1000;
const SUGGESTIONS = ["q1", "q2", "q3"] as const;

/** The reason the assistant couldn't answer, from a 503 assistant_unavailable. */
function unavailableReason(error: ApiClientError): string | null {
  const detail = Array.isArray(error.details) ? (error.details as Array<{ path?: string; message?: string }>).find((d) => d.path === "reason") : undefined;
  return detail?.message ?? null;
}

/**
 * The AI assistant chat: pick a mode (Post / Analytics / Competitors), ask a
 * question about the business's own Instagram, continue earlier chats or start
 * a new one. Self-contained (data, history, errors) so it can sit on its own
 * page today and in a drawer or bottom sheet in the mobile redesign.
 */
export function AssistantChat({ className }: { className?: string }) {
  const { t } = useI18n();
  const { isPreview } = useActiveClient();
  const queryClient = useQueryClient();
  const overview = useAssistant();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const thread = useAssistantThread(conversationId);
  const [chosenMode, setChosenMode] = useState<AssistantModeKey | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<{ text: string; mode: AssistantModeKey } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const modes = overview.data?.modes ?? [];
  const mode = chosenMode && modes.includes(chosenMode) ? chosenMode : (modes[0] ?? "post");
  const messages = conversationId ? (thread.data?.messages ?? []) : [];

  const ask = useAction({
    mutationFn: (vars: { text: string; mode: AssistantModeKey; conversationId: string | null }) =>
      apiFetch<AssistantReplyDto>("/api/assistant/messages", {
        method: "POST",
        body: { text: vars.text, mode: vars.mode, ...(vars.conversationId && { conversationId: vars.conversationId }) },
      }),
    meta: { handlesErrors: true },
    onMutate: (vars) => {
      setNotice(null);
      setPending({ text: vars.text, mode: vars.mode });
      setDraft("");
    },
    onSuccess: (reply) => {
      const id = reply.conversation.id;
      queryClient.setQueryData<AssistantThreadDto>(qk.assistantThread(id), (current) => ({
        ...reply.conversation,
        messages: [...(current?.messages ?? []), ...reply.messages],
      }));
      setConversationId(id);
      queryClient.invalidateQueries({ queryKey: qk.assistant, exact: true });
    },
    onError: (error, vars) => {
      // Nothing was saved: give the question back so it can be sent again.
      setDraft(vars.text);
      if (error instanceof ApiClientError && error.code === "assistant_unavailable") {
        const reason = unavailableReason(error);
        setNotice(t(reason === "rate_limited" ? "assistant.unavailable.busy" : reason === "daily_limit" ? "assistant.unavailable.today" : "assistant.unavailable.generic"));
      } else if (error instanceof ApiClientError && error.code === "assistant_limit") {
        setNotice(t("assistant.unavailable.limit", { limit: overview.data?.usage.limit ?? 0 }));
      } else {
        setNotice(errorMessage(error, t));
      }
    },
    onSettled: () => setPending(null),
  });

  // Deleting a chat: it leaves the list at once (back on error) and the panel starts a new chat.
  const remove = useAction({
    mutationFn: (id: string) => apiFetch<{ id: string }>(`/api/assistant/conversations/${id}`, { method: "DELETE" }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: qk.assistant, exact: true });
      const previous = queryClient.getQueryData<AssistantOverviewDto>(qk.assistant);
      queryClient.setQueryData<AssistantOverviewDto>(qk.assistant, (d) => d && { ...d, conversations: d.conversations.filter((c) => c.id !== id) });
      setConversationId(null);
      setNotice(null);
      return { previous };
    },
    onError: (_error, _id, context) => queryClient.setQueryData(qk.assistant, context?.previous),
    onSuccess: (_data, id) => queryClient.removeQueries({ queryKey: qk.assistantThread(id) }),
  });

  const shown = messages.length + (pending ? 1 : 0) + (notice ? 1 : 0);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [shown]);

  const send = (text: string) => {
    const question = text.trim();
    if (!question || ask.isPending) return;
    ask.mutate({ text: question.slice(0, MAX_QUESTION), mode, conversationId });
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send(draft);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send(draft);
    }
  };
  const newChat = () => {
    setConversationId(null);
    setNotice(null);
  };
  const openChat = (id: string) => {
    setConversationId(id);
    setNotice(null);
  };

  if (isPreview) {
    return (
      <section className={cn("rounded-panel border border-border bg-background", className)}>
        <EmptyState icon={Sparkles} title={t("assistant.title")} hint={t("assistant.previewHint")} />
      </section>
    );
  }
  if (overview.isPending) return <Skeleton className={cn("h-[32rem] rounded-panel", className)} />;
  if (overview.isError) return <ErrorState error={overview.error} onRetry={() => overview.refetch()} className={className} />;

  const conversations = overview.data.conversations;
  const usage = overview.data.usage;
  const atLimit = usage.used >= usage.limit;

  return (
    <section className={cn("flex min-h-[32rem] flex-col rounded-panel border border-border bg-background", className)} aria-label={t("assistant.title")}>
      {/* Header: history and new chat */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="min-w-0 gap-1.5 px-2" disabled={!conversations.length} aria-label={t("assistant.chats")}>
              <History className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{conversationId ? (thread.data?.title ?? t("assistant.chats")) : t("assistant.newChat")}</span>
              <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
            <DropdownMenuLabel>{t("assistant.chats")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {conversations.map((c) => (
              <DropdownMenuItem key={c.id} onSelect={() => openChat(c.id)} className={cn("flex-col items-start gap-0.5", c.id === conversationId && "bg-hover")}>
                <span className="w-full truncate text-body" dir="auto">
                  {c.title}
                </span>
                <TimeAgo iso={c.updatedAt} className="text-caption text-muted" />
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {conversationId && (
          <Button variant="danger" size="icon-sm" className="ms-auto" onClick={() => setConfirmDelete(true)} disabled={ask.isPending} aria-label={t("assistant.deleteChat")}>
            <Trash2 aria-hidden="true" />
          </Button>
        )}
        <Button variant="secondary" size="sm" className={cn("gap-1.5", !conversationId && "ms-auto")} onClick={newChat} disabled={!conversationId || ask.isPending}>
          <Plus className="size-4" aria-hidden="true" />
          {t("assistant.newChat")}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("assistant.deleteTitle")}
        description={t("assistant.deleteBody")}
        confirmLabel={t("assistant.deleteConfirm")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={() => conversationId && remove.mutate(conversationId)}
      />

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        {conversationId && thread.isPending ? (
          <div className="space-y-3">
            <Skeleton className="ms-auto h-10 w-2/3 rounded-card" />
            <Skeleton className="h-24 w-4/5 rounded-card" />
          </div>
        ) : conversationId && thread.isError ? (
          <ErrorState error={thread.error} onRetry={() => thread.refetch()} />
        ) : !messages.length && !pending ? (
          <Intro mode={mode} onPick={send} disabled={ask.isPending || atLimit} />
        ) : (
          messages.map((m) => <Bubble key={m.id} message={m} />)
        )}
        {pending && (
          <>
            <Bubble message={{ id: "pending", role: "user", mode: pending.mode, content: pending.text, language: "en", createdAt: "" }} />
            <p className="flex items-center gap-2 text-caption text-muted" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {t("assistant.thinking")}
            </p>
          </>
        )}
        {notice && (
          <p className="rounded-card border border-border bg-hover px-3 py-2 text-body" role="alert">
            {notice}
          </p>
        )}
        <div ref={endRef} />
      </div>

      {/* Mode + question */}
      <form onSubmit={onSubmit} className="space-y-3 border-t border-border px-4 py-3">
        <ChipSelect
          size="sm"
          label={t("assistant.modeLabel")}
          value={mode}
          onChange={setChosenMode}
          options={modes.map((m) => {
            const Icon = MODE_ICONS[m];
            return { value: m, label: t(`assistant.modes.${m}.label`), icon: <Icon aria-hidden="true" /> };
          })}
        />
        <p className="text-caption text-muted">{t(`assistant.modes.${mode}.hint`)}</p>
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t(`assistant.modes.${mode}.placeholder`)}
            aria-label={t("assistant.inputLabel")}
            maxLength={MAX_QUESTION}
            dir="auto"
            rows={2}
            className="min-h-12 flex-1"
            disabled={atLimit}
          />
          <Button type="submit" size="icon" aria-label={t("assistant.send")} disabled={!draft.trim() || ask.isPending || atLimit}>
            {ask.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send className="rtl:-scale-x-100" aria-hidden="true" />}
          </Button>
        </div>
        <p className="flex flex-wrap justify-between gap-x-3 text-caption text-muted">
          <span>{t("assistant.disclaimer")}</span>
          <span>{t("assistant.usage", { used: usage.used, limit: usage.limit })}</span>
        </p>
      </form>
    </section>
  );
}

function Bubble({ message }: { message: AssistantMessageDto }) {
  const { t } = useI18n();
  const mine = message.role === "user";
  return (
    <div className={cn("flex flex-col gap-1", mine ? "items-end" : "items-start")}>
      <div
        dir="auto"
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-card px-3 py-2 text-start text-body break-words",
          mine ? "bg-primary text-on-primary" : "bg-button-secondary text-foreground",
        )}
      >
        {message.content}
      </div>
      {!mine && <span className="text-caption text-muted">{t(`assistant.modes.${message.mode}.label`)}</span>}
    </div>
  );
}

/** Empty chat: what the current mode does, with a few example questions to start from. */
function Intro({ mode, onPick, disabled }: { mode: AssistantModeKey; onPick: (question: string) => void; disabled: boolean }) {
  const { t } = useI18n();
  const Icon = MODE_ICONS[mode];
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <span className="mb-3 flex size-14 items-center justify-center rounded-pill border-2 border-foreground">
        <Icon className="size-6" strokeWidth={1.5} aria-hidden="true" />
      </span>
      <p className="text-title font-bold">{t("assistant.introTitle")}</p>
      <p className="mt-1 max-w-sm text-body text-muted">{t(`assistant.modes.${mode}.intro`)}</p>
      <div className="mt-4 flex max-w-md flex-col gap-2">
        {SUGGESTIONS.map((key) => t(`assistant.modes.${mode}.examples.${key}`)).map((q) => (
          <Button key={q} variant="outline" size="sm" className="h-auto min-h-8 py-1.5 text-start whitespace-normal" onClick={() => onPick(q)} disabled={disabled}>
            {q}
          </Button>
        ))}
      </div>
    </div>
  );
}
