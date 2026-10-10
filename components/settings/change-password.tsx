"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { KeyRound, Loader2 } from "lucide-react";
import { FloatingInput, ShowPasswordToggle } from "@/components/auth/auth-parts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";
import { newPasswordSchema } from "@/lib/validation/auth";
import { notify } from "@/store/ui-store";

type FieldError = { field: "current" | "new" | "confirm" | null; message: string };

/**
 * Settings card: current password, new password, confirm. Changing it signs
 * the user out on every other device; this session stays signed in.
 */
export function ChangePassword() {
  const { t } = useI18n();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<FieldError | null>(null);

  const change = useMutation<{ changed: boolean; signedIn: boolean }, ApiClientError, void>({
    mutationFn: () => apiFetch("/api/me/password", { method: "PATCH", body: { currentPassword: current, newPassword: next } }),
    meta: { handlesErrors: true },
    onSuccess: (result) => {
      setCurrent("");
      setNext("");
      setConfirm("");
      notify.success(t("settings.password.changed"));
      // Should never happen, but if the fresh session couldn't be issued, log in again.
      if (!result.signedIn) window.location.replace(new URL("/login?expired=1", window.location.origin));
    },
    onError: (e) =>
      setError(e.code === "invalid_password" ? { field: "current", message: t("settings.password.wrongCurrent") } : { field: null, message: errorMessage(e, t) }),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!newPasswordSchema.safeParse(next).success) return setError({ field: "new", message: t("auth.reset.errors.weak") });
    if (next !== confirm) return setError({ field: "confirm", message: t("auth.reset.errors.mismatch") });
    if (next === current) return setError({ field: "new", message: t("settings.password.same") });
    setError(null);
    change.mutate();
  }

  const toggle = <ShowPasswordToggle shown={show} onToggle={() => setShow((v) => !v)} />;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t("settings.password.title")}</CardTitle>
          <CardDescription>{t("settings.password.hint")}</CardDescription>
        </div>
        <KeyRound className="size-5 text-muted" strokeWidth={1.75} aria-hidden="true" />
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="max-w-sm space-y-1.5">
          <FloatingInput
            name="current-password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            label={t("settings.password.current")}
            value={current}
            onChange={setCurrent}
            invalid={error?.field === "current"}
            trailing={current && toggle}
          />
          <FloatingInput
            name="new-password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            label={t("auth.reset.newPassword")}
            value={next}
            onChange={setNext}
            invalid={error?.field === "new"}
          />
          <FloatingInput
            name="confirm-password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            label={t("auth.reset.confirmPassword")}
            value={confirm}
            onChange={setConfirm}
            invalid={error?.field === "confirm"}
          />
          <p className="px-0.5 pt-1 text-caption text-muted">{t("auth.reset.rule")}</p>
          {error && (
            <p role="alert" className="pt-1 text-body text-danger">
              {error.message}
            </p>
          )}
          <div className="pt-2">
            <Button type="submit" disabled={!current || !next || !confirm || change.isPending}>
              {change.isPending && <Loader2 className="size-4 animate-spin" />}
              {t("settings.password.submit")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
