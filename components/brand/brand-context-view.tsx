"use client";

import { useState, type ReactNode } from "react";
import { Loader2, MessageSquareText, Palette, Pencil, ScrollText, Sparkles } from "lucide-react";
import { TagInput } from "@/components/shared/tag-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n/provider";
import type { BrandContextDto, BrandContextPatch, PurposePattern } from "@/types";
import { purposeLabel } from "./brand-post-grid";
import { ColorPalette } from "./color-palette";
import { ToneSlider, toneLabelKey } from "./tone-slider";

/**
 * "Here's what we learned about your brand": summary, visual style, caption
 * style and one card per post purpose. Each section can be edited in place
 * (saved with `onSave`); `readOnly` for admins and previews.
 */
export function BrandContextView({
  context,
  readOnly = false,
  onSave,
}: {
  context: BrandContextDto;
  readOnly?: boolean;
  onSave?: (patch: BrandContextPatch) => Promise<unknown>;
}) {
  const { t } = useI18n();
  const editable = !readOnly && Boolean(onSave);
  const save = onSave ?? (async () => undefined);

  return (
    <div className="space-y-4">
      <Section
        icon={<Sparkles />}
        title={t("brand.context.summary")}
        editable={editable}
        view={<p className="text-body whitespace-pre-line" dir="auto">{context.summary}</p>}
        edit={(done) => <SummaryEditor value={context.summary} onCancel={done} onSave={(summary) => save({ summary }).then(done)} />}
      />

      <Section
        icon={<Palette />}
        title={t("brand.context.visualStyle")}
        editable={editable}
        view={
          <div className="space-y-3">
            <p className="text-body" dir="auto">{context.visualStyle.summary}</p>
            <Traits values={context.visualStyle.traits} />
            {context.colors.length > 0 && <ColorPalette colors={context.colors} readOnly size="sm" />}
            {context.logoUrl && (
              <div className="flex items-center gap-2 text-caption text-muted">
                {/* eslint-disable-next-line @next/next/no-img-element -- uploaded logo */}
                <img src={context.logoUrl} alt={t("brand.basics.logo")} className="size-10 rounded-card border border-border object-contain" />
                {t("brand.context.logoUsed")}
              </div>
            )}
          </div>
        }
        edit={(done) => (
          <VisualEditor context={context} onCancel={done} onSave={(patch) => save(patch).then(done)} />
        )}
      />

      <Section
        icon={<MessageSquareText />}
        title={t("brand.context.captionStyle")}
        editable={editable}
        view={
          <div className="space-y-3">
            <p className="text-body" dir="auto">{context.captionStyle.summary}</p>
            <Traits values={context.captionStyle.traits} />
            <dl className="grid gap-2 text-caption sm:grid-cols-2">
              <Fact label={t("brand.context.tone")} value={t(toneLabelKey(context.toneLevel))} />
              <Fact label={t("brand.context.hashtags")} value={context.captionStyle.hashtags.join(" ") || "—"} ltr />
              <Fact label={t("brand.basics.wordsToUse")} value={context.wordsToUse.join("، ") || "—"} />
              <Fact label={t("brand.basics.wordsToAvoid")} value={context.wordsToAvoid.join("، ") || "—"} />
            </dl>
          </div>
        }
        edit={(done) => <CaptionEditor context={context} onCancel={done} onSave={(patch) => save(patch).then(done)} />}
      />

      <div>
        <h3 className="mb-2 flex items-center gap-2 px-1 text-title font-bold">
          <ScrollText className="size-5" aria-hidden="true" />
          {t("brand.context.purposes")}
        </h3>
        <p className="mb-3 px-1 text-caption text-muted">{t("brand.context.purposesHint")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {context.purposePatterns.map((pattern, i) => (
            <PurposeCard
              key={`${pattern.purpose}-${i}`}
              pattern={pattern}
              editable={editable}
              onSave={(description) =>
                save({ purposePatterns: context.purposePatterns.map((p, j) => (j === i ? { ...p, description } : p)) })
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  view,
  edit,
  editable,
}: {
  icon: ReactNode;
  title: string;
  view: ReactNode;
  edit: (done: () => void) => ReactNode;
  editable: boolean;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  return (
    <Card>
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
        <h3 className="flex items-center gap-2 text-title font-bold [&_svg]:size-5">
          {icon}
          {title}
        </h3>
        {editable && !editing && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="size-4" />
            {t("common.edit")}
          </Button>
        )}
      </div>
      <div className="px-4 pb-4">{editing ? edit(() => setEditing(false)) : view}</div>
    </Card>
  );
}

function Traits({ values }: { values: string[] }) {
  if (values.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {values.map((v) => (
        <li key={v}>
          <Badge variant="neutral" className="h-auto min-h-6 py-0.5 whitespace-normal">
            <bdi>{v}</bdi>
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function Fact({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="rounded-button bg-secondary-bg px-3 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5 font-semibold break-words" dir={ltr ? "ltr" : "auto"}>
        {value}
      </dd>
    </div>
  );
}

function EditorActions({ onCancel, onSave, saving, disabled }: { onCancel: () => void; onSave: () => void; saving: boolean; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="mt-3 flex justify-end gap-2">
      <Button variant="secondary" onClick={onCancel} disabled={saving}>
        {t("common.cancel")}
      </Button>
      <Button onClick={onSave} disabled={saving || disabled}>
        {saving && <Loader2 className="size-4 animate-spin" />}
        {t("common.save")}
      </Button>
    </div>
  );
}

/** Wraps an async save so editors can show a spinner and stay open on failure. */
function useSaving() {
  const [saving, setSaving] = useState(false);
  return {
    saving,
    run: (task: () => Promise<unknown>) => {
      setSaving(true);
      task()
        .catch(() => undefined) // the error toast comes from the caller's mutation
        .finally(() => setSaving(false));
    },
  };
}

function SummaryEditor({ value, onSave, onCancel }: { value: string; onSave: (value: string) => Promise<unknown>; onCancel: () => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value);
  const { saving, run } = useSaving();
  return (
    <div>
      <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} dir="auto" maxLength={1500} aria-label={t("brand.context.summary")} autoFocus />
      <EditorActions onCancel={onCancel} saving={saving} disabled={!draft.trim()} onSave={() => run(() => onSave(draft.trim()))} />
    </div>
  );
}

function VisualEditor({ context, onSave, onCancel }: { context: BrandContextDto; onSave: (patch: BrandContextPatch) => Promise<unknown>; onCancel: () => void }) {
  const { t } = useI18n();
  const [summary, setSummary] = useState(context.visualStyle.summary);
  const [traits, setTraits] = useState(context.visualStyle.traits);
  const [colors, setColors] = useState(context.colors);
  const { saving, run } = useSaving();
  return (
    <div className="space-y-4">
      <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} dir="auto" maxLength={1000} aria-label={t("brand.context.visualStyle")} />
      <div>
        <p className="mb-2 text-caption font-semibold text-muted">{t("brand.context.traits")}</p>
        <TagInput values={traits} onChange={setTraits} placeholder={t("brand.context.traitPlaceholder")} addLabel={t("common.add")} />
      </div>
      <div>
        <p className="mb-2 text-caption font-semibold text-muted">{t("brand.basics.colors")}</p>
        <ColorPalette colors={colors} onChange={setColors} />
      </div>
      <EditorActions onCancel={onCancel} saving={saving} onSave={() => run(() => onSave({ visualStyle: { summary: summary.trim(), traits }, colors }))} />
    </div>
  );
}

function CaptionEditor({ context, onSave, onCancel }: { context: BrandContextDto; onSave: (patch: BrandContextPatch) => Promise<unknown>; onCancel: () => void }) {
  const { t } = useI18n();
  const [summary, setSummary] = useState(context.captionStyle.summary);
  const [traits, setTraits] = useState(context.captionStyle.traits);
  const [hashtags, setHashtags] = useState(context.captionStyle.hashtags);
  const [tone, setTone] = useState(context.toneLevel);
  const [wordsToUse, setWordsToUse] = useState(context.wordsToUse);
  const [wordsToAvoid, setWordsToAvoid] = useState(context.wordsToAvoid);
  const { saving, run } = useSaving();
  return (
    <div className="space-y-4">
      <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} dir="auto" maxLength={1000} aria-label={t("brand.context.captionStyle")} />
      <div>
        <p className="mb-2 text-caption font-semibold text-muted">{t("brand.context.traits")}</p>
        <TagInput values={traits} onChange={setTraits} placeholder={t("brand.context.traitPlaceholder")} addLabel={t("common.add")} />
      </div>
      <div>
        <p className="mb-2 text-caption font-semibold text-muted">{t("brand.context.hashtags")}</p>
        <TagInput
          values={hashtags}
          onChange={setHashtags}
          placeholder="#hashtag"
          addLabel={t("common.add")}
          normalize={(v) => (v.startsWith("#") ? v : `#${v}`).replace(/\s+/g, "_")}
        />
      </div>
      <div>
        <p className="mb-3 text-caption font-semibold text-muted">{t("brand.context.tone")}</p>
        <ToneSlider value={tone} onChange={setTone} />
      </div>
      <div>
        <p className="mb-2 text-caption font-semibold text-muted">{t("brand.basics.wordsToUse")}</p>
        <TagInput values={wordsToUse} onChange={setWordsToUse} placeholder={t("settings.voice.brandWordPlaceholder")} addLabel={t("common.add")} />
      </div>
      <div>
        <p className="mb-2 text-caption font-semibold text-muted">{t("brand.basics.wordsToAvoid")}</p>
        <TagInput values={wordsToAvoid} onChange={setWordsToAvoid} placeholder={t("settings.voice.brandWordPlaceholder")} addLabel={t("common.add")} />
      </div>
      <EditorActions
        onCancel={onCancel}
        saving={saving}
        onSave={() => run(() => onSave({ captionStyle: { summary: summary.trim(), traits, hashtags }, toneLevel: tone, wordsToUse, wordsToAvoid }))}
      />
    </div>
  );
}

function PurposeCard({ pattern, editable, onSave }: { pattern: PurposePattern; editable: boolean; onSave: (description: string) => Promise<unknown> }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const { saving, run } = useSaving();
  return (
    <Card className="p-4">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <Badge variant="blue">
          <bdi>{purposeLabel(t, pattern.purpose, pattern.label)}</bdi>
        </Badge>
        {editable && draft === null && (
          <Button variant="ghost" size="icon-sm" onClick={() => setDraft(pattern.description)} aria-label={t("common.edit")}>
            <Pencil className="size-4" />
          </Button>
        )}
      </div>
      {draft === null ? (
        <p className="text-body" dir="auto">{pattern.description}</p>
      ) : (
        <div>
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} dir="auto" maxLength={600} aria-label={purposeLabel(t, pattern.purpose, pattern.label)} autoFocus />
          <EditorActions
            onCancel={() => setDraft(null)}
            saving={saving}
            disabled={!draft.trim()}
            onSave={() => run(() => onSave(draft.trim()).then(() => setDraft(null)))}
          />
        </div>
      )}
    </Card>
  );
}
