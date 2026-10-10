"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, UserMinus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { qk, useAction } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { notify } from "@/store/ui-store";
import type { CompetitorDto } from "@/types";
import { competitorName } from "./helpers";

/**
 * Instagram-style confirmation sheet. Only "Remove" deletes: the card disappears
 * right away (optimistic) and comes back if the request fails. The sheet can't
 * be dismissed while the request is running.
 */
export function RemoveCompetitorDialog({
  competitor,
  onOpenChange,
  onRemoved,
}: {
  /** The competitor to remove; null when closed. */
  competitor: CompetitorDto | null;
  onOpenChange: (open: boolean) => void;
  onRemoved?: () => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const remove = useAction<unknown, CompetitorDto, { previous?: CompetitorDto[] }>({
    mutationFn: (target) => apiFetch(`/api/competitors/${target.id}`, { method: "DELETE" }),
    meta: { handlesErrors: true },
    onMutate: async (target) => {
      setError(null);
      await queryClient.cancelQueries({ queryKey: qk.competitors });
      const previous = queryClient.getQueryData<CompetitorDto[]>(qk.competitors);
      queryClient.setQueryData<CompetitorDto[]>(qk.competitors, (list) => list?.filter((c) => c.id !== target.id));
      return { previous };
    },
    onError: (e, _target, context) => {
      queryClient.setQueryData(qk.competitors, context?.previous);
      setError(errorMessage(e, t));
    },
    onSuccess: (_data, target) => {
      queryClient.removeQueries({ queryKey: [...qk.competitors, target.id], exact: true });
      notify.success(t("competitors.removed", { handle: target.handle }));
      onOpenChange(false);
      onRemoved?.();
    },
  });

  const close = (open: boolean) => {
    if (open || remove.isPending) return;
    setError(null);
    onOpenChange(false);
  };

  const name = competitor ? competitorName(competitor) : "";
  const label = !competitor ? "" : name === competitor.handle ? `@${competitor.handle}` : `${name} (@${competitor.handle})`;

  return (
    <Dialog open={competitor !== null} onOpenChange={close}>
      <DialogContent showClose={false} className="max-w-[400px]">
        <div className="flex flex-col items-center px-8 pt-8 pb-5 text-center">
          <span className="mb-4 flex size-16 items-center justify-center rounded-pill border-2 border-foreground">
            <UserMinus className="size-7" strokeWidth={1.5} aria-hidden="true" />
          </span>
          <DialogTitle className="text-heading">{t("competitors.removeDialog.title", { name: label })}</DialogTitle>
          <DialogDescription className="mt-2">{t("competitors.removeDialog.body")}</DialogDescription>
          {error && (
            <p role="alert" className="mt-3 text-body text-danger">
              {error}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => competitor && remove.mutate(competitor)}
          disabled={remove.isPending}
          className="flex min-h-12 w-full items-center justify-center gap-2 border-t border-separator text-body font-bold text-danger hover:bg-hover disabled:opacity-60"
        >
          {remove.isPending && <Loader2 className="size-4 animate-spin" />}
          {remove.isPending ? t("competitors.removeDialog.removing") : t("competitors.removeDialog.confirm")}
        </button>
        <button
          type="button"
          onClick={() => close(false)}
          disabled={remove.isPending}
          className="block min-h-12 w-full border-t border-separator text-body hover:bg-hover disabled:opacity-60"
        >
          {t("common.cancel")}
        </button>
      </DialogContent>
    </Dialog>
  );
}
