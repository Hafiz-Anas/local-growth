"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";
import { notify } from "@/store/ui-store";
import type { AdminBusinessDto } from "@/types";

/**
 * Strong confirmation for deleting a business: spells out what is lost and
 * only enables the button once the business name is typed exactly.
 */
export function DeleteBusinessDialog({
  business,
  open,
  onOpenChange,
}: {
  business: AdminBusinessDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showClose={false} className="max-w-[440px]">
        {/* Mounted only while open, so the typed name resets each time. */}
        {open && <DeleteForm business={business} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function DeleteForm({ business, onCancel }: { business: AdminBusinessDto; onCancel: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim() === business.name;

  const remove = useMutation<unknown, ApiClientError>({
    mutationFn: () => apiFetch(`/api/admin/businesses/${business.id}`, { method: "DELETE" }),
    meta: { handlesErrors: true },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["admin", "business", business.id] });
      queryClient.removeQueries({ queryKey: ["admin", "permissions", business.id] });
      queryClient.invalidateQueries({ queryKey: ["admin"] });
      notify.success(t("admin.delete.done", { name: business.name }));
      router.replace("/admin/clients");
    },
    onError: (e) => setError(errorMessage(e, t)),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (matches) remove.mutate();
      }}
    >
      <div className="flex flex-col items-center px-6 pt-7 pb-4 text-center">
        <span className="mb-4 flex size-16 items-center justify-center rounded-pill border-2 border-danger text-danger">
          <AlertTriangle className="size-7" strokeWidth={1.75} />
        </span>
        <DialogTitle className="text-heading">{t("admin.delete.title", { name: business.name })}</DialogTitle>
        <DialogDescription className="mt-2">{t("admin.delete.body")}</DialogDescription>
      </div>
      <ul className="mx-6 mb-4 list-disc space-y-1 rounded-card bg-secondary-bg py-3 ps-8 pe-4 text-body">
        <li>{t("admin.delete.users", { count: business.users.length })}</li>
        <li>{t("admin.delete.content")}</li>
        <li>{t("admin.delete.connection")}</li>
      </ul>
      <div className="px-6 pb-4">
        <label htmlFor="confirm-business-name" className="mb-1.5 block text-body">
          {t("admin.delete.typeToConfirm")} <span className="font-semibold select-all">{business.name}</span>
        </label>
        <Input id="confirm-business-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus dir="auto" />
        {error && (
          <p role="alert" className="mt-2 text-body text-danger">
            {error}
          </p>
        )}
      </div>
      <button
        type="submit"
        disabled={!matches || remove.isPending}
        className="flex min-h-12 w-full items-center justify-center gap-2 border-t border-separator text-body font-bold text-danger hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40"
      >
        {remove.isPending && <Loader2 className="size-4 animate-spin" />}
        {t("admin.delete.confirm")}
      </button>
      <Button type="button" variant="ghost" onClick={onCancel} className="min-h-12 w-full rounded-none border-t border-separator">
        {t("common.cancel")}
      </Button>
    </form>
  );
}
