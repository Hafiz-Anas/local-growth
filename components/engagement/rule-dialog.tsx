"use client";

import { useState } from "react";
import { Check, Loader2, Trash2 } from "lucide-react";
import { BrandMedia } from "@/components/brand/brand-post-grid";
import { Segmented } from "@/components/settings/segmented";
import { FeatureToggle } from "@/components/shared/feature-toggle";
import { Skeleton } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useInstagramMedia } from "@/lib/api/brand";
import { useI18n } from "@/lib/i18n/provider";
import { MAX_RULE_POSTS, PRIVATE_REPLY_MAX, PUBLIC_REPLY_MAX, normalizeText } from "@/lib/keyword-replies";
import { cn } from "@/lib/utils";
import type { EngagementRuleDto } from "@/types";

export type RuleValues = Pick<EngagementRuleDto, "keywords" | "matchType" | "commentReply" | "dmMessage" | "scope" | "mediaIds" | "autoSend" | "active">;

/** Keywords typed as "MENU, منيو، price": split on Latin and Arabic commas, duplicates (after normalizing) dropped. */
export function parseKeywords(input: string): string[] {
  const out: string[] = [];
  for (const raw of input.split(/[,،]/)) {
    const keyword = raw.trim();
    if (keyword && normalizeText(keyword) && !out.some((k) => normalizeText(k) === normalizeText(keyword))) out.push(keyword);
  }
  return out;
}

export function RuleDialog({
  rule,
  open,
  onOpenChange,
  onSave,
  onDelete,
  saving = false,
}: {
  /** `null` creates a new rule. */
  rule: EngagementRuleDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (values: RuleValues) => void;
  onDelete?: () => void;
  saving?: boolean;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(92dvh,820px)] max-w-[560px] flex-col">
        <DialogHeader>
          <DialogTitle>{rule ? t("engagement.rules.editTitle") : t("engagement.rules.newTitle")}</DialogTitle>
        </DialogHeader>
        {/* Keyed so the form resets whenever a different rule is opened. */}
        <RuleForm key={rule?.id ?? "new"} rule={rule} onCancel={() => onOpenChange(false)} onSave={onSave} onDelete={onDelete} saving={saving} />
      </DialogContent>
    </Dialog>
  );
}

function CharCount({ value, max }: { value: string; max: number }) {
  const { t } = useI18n();
  return (
    <span className={cn("shrink-0 text-caption tabular-nums", value.length > max ? "text-danger" : "text-muted")}>
      {t("engagement.rules.chars", { count: value.length, max })}
    </span>
  );
}

function RuleForm({
  rule,
  onCancel,
  onSave,
  onDelete,
  saving,
}: {
  rule: EngagementRuleDto | null;
  onCancel: () => void;
  onSave: (values: RuleValues) => void;
  onDelete?: () => void;
  saving: boolean;
}) {
  const { t } = useI18n();
  const [keywords, setKeywords] = useState(rule?.keywords.join(", ") ?? "");
  const [matchType, setMatchType] = useState<RuleValues["matchType"]>(rule?.matchType ?? "word");
  const [commentReply, setCommentReply] = useState(rule?.commentReply ?? "");
  const [dmMessage, setDmMessage] = useState(rule?.dmMessage ?? "");
  const [scope, setScope] = useState<RuleValues["scope"]>(rule?.scope ?? "all");
  const [mediaIds, setMediaIds] = useState<string[]>(rule?.mediaIds ?? []);
  const [autoSend, setAutoSend] = useState(rule?.autoSend ?? true);
  const [active, setActive] = useState(rule?.active ?? true);
  const media = useInstagramMedia(scope === "selected");

  const parsed = parseKeywords(keywords);
  const valid =
    parsed.length > 0 &&
    commentReply.trim().length > 0 &&
    commentReply.length <= PUBLIC_REPLY_MAX &&
    dmMessage.length <= PRIVATE_REPLY_MAX &&
    (scope === "all" || mediaIds.length > 0);

  const togglePost = (id: string) =>
    setMediaIds((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : ids.length < MAX_RULE_POSTS ? [...ids, id] : ids));

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSave({ keywords: parsed, matchType, commentReply: commentReply.trim(), dmMessage: dmMessage.trim(), scope, mediaIds: scope === "selected" ? mediaIds : [], autoSend, active });
      }}
    >
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <div className="space-y-1.5">
          <Label htmlFor="rule-keywords">{t("engagement.rules.keywords")}</Label>
          <Input id="rule-keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder={t("engagement.rules.keywordsPlaceholder")} dir="auto" autoComplete="off" />
          {parsed.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1" aria-hidden="true">
              {parsed.map((k) => (
                <span key={k} className="rounded-pill border border-border px-2.5 py-0.5 text-caption font-semibold" dir="auto">
                  {k}
                </span>
              ))}
            </div>
          )}
          <p className="text-caption text-muted">{t("engagement.rules.keywordsHint")}</p>
        </div>

        <div className="space-y-1.5">
          <p className="text-body font-semibold">{t("engagement.rules.matchType")}</p>
          <Segmented
            label={t("engagement.rules.matchType")}
            value={matchType}
            onChange={setMatchType}
            options={[
              { value: "word", label: t("engagement.rules.match.word") },
              { value: "exact", label: t("engagement.rules.match.exact") },
            ]}
          />
          <p className="text-caption text-muted">{t(matchType === "word" ? "engagement.rules.match.wordHint" : "engagement.rules.match.exactHint")}</p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-end justify-between gap-2">
            <Label htmlFor="rule-reply">{t("engagement.rules.commentReply")}</Label>
            <CharCount value={commentReply} max={PUBLIC_REPLY_MAX} />
          </div>
          <Textarea id="rule-reply" value={commentReply} onChange={(e) => setCommentReply(e.target.value)} placeholder={t("engagement.rules.commentReplyPlaceholder")} rows={3} dir="auto" />
          <p className="text-caption text-muted">{t("engagement.rules.commentReplyHint")}</p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-end justify-between gap-2">
            <Label htmlFor="rule-dm">{t("engagement.rules.dmMessage")}</Label>
            <CharCount value={dmMessage} max={PRIVATE_REPLY_MAX} />
          </div>
          <Textarea id="rule-dm" value={dmMessage} onChange={(e) => setDmMessage(e.target.value)} rows={3} dir="auto" />
          <p className="text-caption text-muted">{t("engagement.rules.dmMessageHint")}</p>
        </div>

        <div className="space-y-2">
          <p className="text-body font-semibold">{t("engagement.rules.scope")}</p>
          <Segmented
            label={t("engagement.rules.scope")}
            value={scope}
            onChange={setScope}
            options={[
              { value: "all", label: t("engagement.rules.scopeAll") },
              { value: "selected", label: t("engagement.rules.scopeSelected") },
            ]}
          />
          {scope === "selected" && (
            <div className="space-y-2">
              <p className="flex items-center justify-between gap-2 text-caption text-muted">
                <span>{t("engagement.rules.pickPosts")}</span>
                <span className="font-semibold text-foreground">{t("engagement.rules.postsSelected", { count: mediaIds.length })}</span>
              </p>
              {media.isPending ? (
                <div className="grid grid-cols-4 gap-1">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="aspect-square" />
                  ))}
                </div>
              ) : media.isError ? (
                <p className="rounded-card bg-secondary-bg px-3 py-2 text-caption text-muted">{t("engagement.rules.postsError")}</p>
              ) : media.data.length === 0 ? (
                <p className="rounded-card bg-secondary-bg px-3 py-2 text-caption text-muted">{t("engagement.rules.postsEmpty")}</p>
              ) : (
                <ul className="grid max-h-64 grid-cols-4 gap-1 overflow-y-auto" role="listbox" aria-multiselectable="true" aria-label={t("engagement.rules.pickPosts")}>
                  {media.data.map((item) => {
                    const selected = mediaIds.includes(item.id);
                    return (
                      <li key={item.id} role="option" aria-selected={selected}>
                        <button
                          type="button"
                          onClick={() => togglePost(item.id)}
                          className="relative block w-full outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          title={item.caption}
                          aria-label={item.caption || item.id}
                        >
                          <BrandMedia url={item.mediaUrl} type={item.mediaType} className="aspect-square w-full" />
                          {selected && (
                            <span className="absolute inset-0 flex items-start justify-end bg-black/25 p-1.5 ring-3 ring-primary ring-inset">
                              <span className="flex size-6 items-center justify-center rounded-pill bg-primary text-white">
                                <Check className="size-4" />
                              </span>
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="divide-y divide-separator border-t border-separator">
          <FeatureToggle label={t("engagement.rules.autoSend")} description={t("engagement.rules.autoSendHint")} checked={autoSend} onCheckedChange={setAutoSend} />
          <FeatureToggle label={t("engagement.rules.active")} description={t("engagement.rules.activeHint")} checked={active} onCheckedChange={setActive} />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-separator p-4">
        {rule && onDelete && (
          <Button variant="ghost" className="me-auto text-danger" onClick={onDelete} disabled={saving}>
            <Trash2 className="size-4" />
            {t("engagement.rules.delete")}
          </Button>
        )}
        <Button variant="secondary" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={!valid || saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}
