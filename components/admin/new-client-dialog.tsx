"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Segmented } from "@/components/settings/segmented";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PLAN_IDS } from "@/config/plans";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";
import { emailSchema, newPasswordSchema } from "@/lib/validation/auth";
import { notify } from "@/store/ui-store";
import type { AdminBusinessDto, PlanId } from "@/types";

/** Admin: create a business (with its plan's preset permissions) and optionally its login. */
export function NewClientDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t("admin.newClient.title")}</DialogTitle>
        </DialogHeader>
        {open && <NewClientForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function NewClientForm({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", handle: "", location: "", ownerName: "", ownerEmail: "", ownerPassword: "" });
  const [plan, setPlan] = useState<PlanId>("starter");
  const [withOwner, setWithOwner] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const create = useMutation<AdminBusinessDto, ApiClientError>({
    mutationFn: () =>
      apiFetch<AdminBusinessDto>("/api/admin/businesses", {
        method: "POST",
        body: {
          name: form.name,
          instagramHandle: form.handle,
          location: form.location,
          plan,
          ...(withOwner && { owner: { name: form.ownerName || form.name, email: form.ownerEmail, password: form.ownerPassword } }),
        },
      }),
    meta: { handlesErrors: true },
    onSuccess: (business) => {
      queryClient.invalidateQueries({ queryKey: ["admin"] });
      notify.success(t("admin.newClient.created", { name: business.name }));
      onDone();
      router.push(`/admin/clients/${business.id}`);
    },
    onError: (e) => setError(e.code === "conflict" ? t("admin.newClient.taken") : errorMessage(e, t)),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim() || !form.location.trim()) return setError(t("admin.newClient.required"));
    if (!/^@?[a-zA-Z0-9._]{1,30}$/.test(form.handle.trim())) return setError(t("competitors.invalidHandle"));
    if (withOwner) {
      if (!emailSchema.safeParse(form.ownerEmail).success) return setError(t("auth.reset.errors.invalidEmail"));
      if (!newPasswordSchema.safeParse(form.ownerPassword).success) return setError(t("auth.reset.errors.weak"));
    }
    setError(null);
    create.mutate();
  }

  return (
    <form onSubmit={submit} noValidate className="max-h-[70dvh] space-y-4 overflow-y-auto p-4">
      <Field id="nc-name" label={t("admin.newClient.name")}>
        <Input id="nc-name" value={form.name} onChange={set("name")} autoFocus />
      </Field>
      <Field id="nc-handle" label={t("admin.newClient.handle")}>
        <Input id="nc-handle" value={form.handle} onChange={set("handle")} placeholder="business.kw" dir="ltr" />
      </Field>
      <Field id="nc-location" label={t("admin.newClient.location")}>
        <Input id="nc-location" value={form.location} onChange={set("location")} placeholder="Salmiya, Kuwait" />
      </Field>
      <div className="space-y-1.5">
        <p className="text-body font-semibold">{t("admin.permissions.plan")}</p>
        <Segmented<PlanId> label={t("admin.permissions.plan")} value={plan} onChange={setPlan} options={PLAN_IDS.map((p) => ({ value: p, label: t(`plans.${p}`) }))} />
        <p className="text-caption text-muted">{t("admin.newClient.planHint")}</p>
      </div>

      <div className="rounded-card border border-border p-3">
        <label className="flex items-center justify-between gap-3">
          <span>
            <span className="block text-body font-semibold">{t("admin.newClient.owner")}</span>
            <span className="block text-caption text-muted">{t("admin.newClient.ownerHint")}</span>
          </span>
          <Switch checked={withOwner} onCheckedChange={setWithOwner} />
        </label>
        {withOwner && (
          <div className="mt-3 space-y-3">
            <Field id="nc-owner-name" label={t("admin.newClient.ownerName")}>
              <Input id="nc-owner-name" value={form.ownerName} onChange={set("ownerName")} placeholder={form.name} />
            </Field>
            <Field id="nc-owner-email" label={t("auth.email")}>
              <Input id="nc-owner-email" type="email" value={form.ownerEmail} onChange={set("ownerEmail")} dir="ltr" autoComplete="off" />
            </Field>
            <Field id="nc-owner-password" label={t("admin.newClient.ownerPassword")} hint={t("auth.reset.rule")}>
              <Input id="nc-owner-password" type="text" value={form.ownerPassword} onChange={set("ownerPassword")} dir="ltr" autoComplete="new-password" />
            </Field>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-body text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending && <Loader2 className="size-4 animate-spin" />}
          {t("admin.newClient.submit")}
        </Button>
      </div>
    </form>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-caption text-muted">{hint}</p>}
    </div>
  );
}
