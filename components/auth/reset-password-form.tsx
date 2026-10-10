"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleCheck, KeyRound, Loader2, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";
import { newPasswordSchema } from "@/lib/validation/auth";
import { AuthCard, FloatingInput, ShowPasswordToggle } from "./auth-parts";

type Status = "form" | "saving" | "done" | "invalid";
type FormError = "weak" | "mismatch" | "rateLimited" | "generic";

/** Step 2 of the reset flow, opened from the emailed link. */
export function ResetPasswordForm({ token, valid }: { token: string; valid: boolean }) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<Status>(valid ? "form" : "invalid");
  const [error, setError] = useState<FormError | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newPasswordSchema.safeParse(password).success) return setError("weak");
    if (password !== confirm) return setError("mismatch");

    setError(null);
    setStatus("saving");
    try {
      const res = await fetch("/api/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (res.ok) return setStatus("done");
      const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
      if (body?.error?.code === "invalid_token") return setStatus("invalid");
      setError(res.status === 429 ? "rateLimited" : "generic");
    } catch {
      setError("generic");
    }
    setStatus("form");
  }

  if (status === "invalid") {
    return (
      <AuthCard icon={<KeyRound strokeWidth={1.25} />} title={t("auth.reset.invalidTitle")} description={t("auth.reset.invalidBody")}>
        <Button asChild className="w-full">
          <Link href="/forgot-password">{t("auth.reset.requestNew")}</Link>
        </Button>
      </AuthCard>
    );
  }

  if (status === "done") {
    return (
      <AuthCard icon={<CircleCheck strokeWidth={1.25} />} title={t("auth.reset.doneTitle")} description={t("auth.reset.doneBody")}>
        <Button asChild className="w-full">
          <Link href="/login">{t("auth.login")}</Link>
        </Button>
      </AuthCard>
    );
  }

  const toggle = <ShowPasswordToggle shown={show} onToggle={() => setShow((v) => !v)} />;
  return (
    <AuthCard icon={<LockKeyhole strokeWidth={1.25} />} title={t("auth.reset.resetTitle")} description={t("auth.reset.resetBody")}>
      <form onSubmit={submit} noValidate className="space-y-1.5">
        <FloatingInput
          name="password"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          label={t("auth.reset.newPassword")}
          value={password}
          onChange={setPassword}
          invalid={error === "weak"}
          trailing={password && toggle}
          autoFocus
        />
        <FloatingInput
          name="confirm"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          label={t("auth.reset.confirmPassword")}
          value={confirm}
          onChange={setConfirm}
          invalid={error === "mismatch"}
        />
        <p className="px-0.5 pt-1 text-caption text-muted">{t("auth.reset.rule")}</p>
        <Button type="submit" className="mt-3 w-full" disabled={!password || !confirm || status === "saving"} aria-busy={status === "saving"}>
          {status === "saving" ? <Loader2 className="size-4 animate-spin" aria-label={t("auth.reset.saving")} /> : t("auth.reset.submit")}
        </Button>
        {error && (
          <p role="alert" className="pt-3 text-center text-body text-danger">
            {t(`auth.reset.errors.${error}`)}
          </p>
        )}
      </form>
    </AuthCard>
  );
}
