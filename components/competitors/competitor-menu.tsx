"use client";

import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/** Three-dot menu (Edit / Remove) on competitor cards and the detail header. */
export function CompetitorMenu({ name, onEdit, onRemove, className }: { name: string; onEdit: () => void; onRemove: () => void; className?: string }) {
  const { t } = useI18n();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className={cn("relative z-10", className)} aria-label={t("competitors.menu", { name })}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      {/* Both items open a dialog: don't hand focus back to the trigger on close, or the
          dialog sees that as "focus outside" and can dismiss itself. */}
      <DropdownMenuContent align="end" className="min-w-[200px]" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil />
          {t("common.edit")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onRemove} className="text-danger">
          <Trash2 />
          {t("competitors.menuDelete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
