"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n/provider";
import type { EngagementRuleDto } from "@/types";

export interface RuleValues {
  keywords: string[];
  dmMessage: string;
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
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{rule ? t("engagement.rules.editTitle") : t("engagement.rules.newTitle")}</DialogTitle>
        </DialogHeader>
        {/* Keyed so the form resets whenever a different rule is opened. */}
        <RuleForm key={rule?.id ?? "new"} rule={rule} onCancel={() => onOpenChange(false)} onSave={onSave} onDelete={onDelete} saving={saving} />
      </DialogContent>
    </Dialog>
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
  const [message, setMessage] = useState(rule?.dmMessage ?? "");
  const parsed = keywords
    .split(/[,،]/)
    .map((k) => k.trim())
    .filter(Boolean);

  return (
    <form
      className="space-y-4 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ keywords: parsed, dmMessage: message.trim() });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="rule-keywords">{t("engagement.rules.keywords")}</Label>
        <Input id="rule-keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="price, بكم, delivery" dir="auto" />
        <p className="text-caption text-muted">{t("engagement.rules.keywordsHint")}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="rule-message">{t("engagement.rules.message")}</Label>
        <Textarea id="rule-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={4} dir="auto" maxLength={1000} />
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        {rule && onDelete && (
          <Button variant="ghost" className="me-auto text-danger" onClick={onDelete} disabled={saving}>
            <Trash2 className="size-4" />
            {t("engagement.rules.delete")}
          </Button>
        )}
        <Button variant="secondary" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={parsed.length === 0 || !message.trim() || saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}
