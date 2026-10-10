"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Mail, MoreHorizontal, UserCheck, UserRound, UserX } from "lucide-react";
import { Avatar } from "@/components/shared/avatar";
import { EmptyState, ErrorState, SkeletonList } from "@/components/shared/states";
import { TimeAgo } from "@/components/shared/time-ago";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog, Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAdminUsers } from "@/lib/api/admin";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { initials, toneFor } from "@/lib/utils";
import { newPasswordSchema } from "@/lib/validation/auth";
import { notify } from "@/store/ui-store";
import type { AdminUserDto } from "@/types";

/** The business's logins with admin actions: reset password, suspend / reactivate. */
export function BusinessUsersCard({ businessId }: { businessId: string }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const users = useAdminUsers(businessId);
  const [suspending, setSuspending] = useState<AdminUserDto | null>(null);
  const [settingPassword, setSettingPassword] = useState<AdminUserDto | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: qk.admin.users(businessId) });
    queryClient.invalidateQueries({ queryKey: qk.admin.business(businessId) });
    queryClient.invalidateQueries({ queryKey: qk.admin.activity(businessId) });
  };
  const setStatus = useMutation<AdminUserDto, ApiClientError, { user: AdminUserDto; suspend: boolean }>({
    mutationFn: ({ user, suspend }) => apiFetch(`/api/admin/users/${user.id}/${suspend ? "suspend" : "reactivate"}`, { method: "POST" }),
    onSuccess: (user, { suspend }) => {
      refresh();
      notify.success(t(suspend ? "admin.users.suspended" : "admin.users.reactivated", { name: user.name }));
    },
  });
  const sendLink = useMutation<unknown, ApiClientError, AdminUserDto>({
    mutationFn: (user) => apiFetch(`/api/admin/users/${user.id}/reset-password`, { method: "POST", body: { sendEmail: true } }),
    onSuccess: (_d, user) => {
      refresh();
      notify.success(t("admin.users.linkSent", { email: user.email }));
    },
  });

  return (
    <Card className="mb-6">
      <CardHeader className="border-b border-separator">
        <div>
          <CardTitle>{t("admin.users.title")}</CardTitle>
          <CardDescription>{t("admin.users.hint")}</CardDescription>
        </div>
      </CardHeader>
      {users.isPending ? (
        <SkeletonList rows={1} />
      ) : users.isError ? (
        <ErrorState error={users.error} onRetry={() => users.refetch()} className="m-4" />
      ) : users.data.length === 0 ? (
        <EmptyState icon={UserRound} title={t("admin.users.emptyTitle")} hint={t("admin.users.emptyHint")} />
      ) : (
        <ul className="divide-y divide-separator">
          {users.data.map((user) => {
            const suspended = user.status === "suspended";
            return (
              <li key={user.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar src={user.avatarUrl} initials={initials(user.name)} tone={toneFor(user.id)} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-body font-semibold">
                    <span className="truncate">{user.name}</span>
                    {suspended && <Badge variant="neutral" size="sm">{t("admin.users.suspendedBadge")}</Badge>}
                  </p>
                  <p className="truncate text-caption text-muted">
                    <bdi>{user.email}</bdi> ·{" "}
                    {user.lastLoginAt ? (
                      <>
                        {t("admin.users.lastLogin")} <TimeAgo iso={user.lastLoginAt} />
                      </>
                    ) : (
                      t("admin.users.neverLoggedIn")
                    )}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={t("admin.users.actions", { name: user.name })}>
                      {setStatus.isPending && setStatus.variables?.user.id === user.id ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
                    </Button>
                  </DropdownMenuTrigger>
                  {/* Items open dialogs: keep focus from jumping back to the trigger, which can dismiss them. */}
                  <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
                    <DropdownMenuItem onSelect={() => sendLink.mutate(user)}>
                      <Mail />
                      {t("admin.users.sendLink")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setSettingPassword(user)}>
                      <KeyRound />
                      {t("admin.users.setPassword")}
                    </DropdownMenuItem>
                    {suspended ? (
                      <DropdownMenuItem onSelect={() => setStatus.mutate({ user, suspend: false })}>
                        <UserCheck />
                        {t("admin.users.reactivate")}
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={() => setSuspending(user)} className="text-danger">
                        <UserX />
                        {t("admin.users.suspend")}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={suspending !== null}
        onOpenChange={(open) => !open && setSuspending(null)}
        title={t("admin.users.suspendTitle", { name: suspending?.name ?? "" })}
        description={t("admin.users.suspendBody")}
        confirmLabel={t("admin.users.suspend")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={() => suspending && setStatus.mutate({ user: suspending, suspend: true })}
      />
      <SetPasswordDialog user={settingPassword} onClose={() => setSettingPassword(null)} onDone={refresh} />
    </Card>
  );
}

function SetPasswordDialog({ user, onClose, onDone }: { user: AdminUserDto | null; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t("admin.users.setPasswordTitle")}</DialogTitle>
        </DialogHeader>
        {user && <SetPasswordForm key={user.id} user={user} onClose={onClose} onDone={onDone} />}
      </DialogContent>
    </Dialog>
  );
}

function SetPasswordForm({ user, onClose, onDone }: { user: AdminUserDto; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation<unknown, ApiClientError>({
    mutationFn: () => apiFetch(`/api/admin/users/${user.id}/reset-password`, { method: "POST", body: { password } }),
    meta: { handlesErrors: true },
    onSuccess: () => {
      onDone();
      onClose();
      notify.success(t("admin.users.passwordSet", { name: user.name }));
    },
    onError: (e) => setError(errorMessage(e, t)),
  });
  return (
    <form
      className="space-y-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!newPasswordSchema.safeParse(password).success) return setError(t("auth.reset.errors.weak"));
        setError(null);
        save.mutate();
      }}
    >
      <p className="text-body text-muted">{t("admin.users.setPasswordBody", { name: user.name })}</p>
      <div className="space-y-1.5">
        <Label htmlFor="admin-new-password">{t("auth.reset.newPassword")}</Label>
        <Input id="admin-new-password" type="text" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" autoComplete="new-password" autoFocus />
        <p className="text-caption text-muted">{t("auth.reset.rule")}</p>
      </div>
      {error && (
        <p role="alert" className="text-body text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={!password || save.isPending}>
          {save.isPending && <Loader2 className="size-4 animate-spin" />}
          {t("admin.users.setPassword")}
        </Button>
      </div>
    </form>
  );
}
