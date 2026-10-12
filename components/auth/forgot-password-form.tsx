"use client";

import { useState } from "react";
import { Loader2, Lock, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";
import { emailSchema } from "@/lib/validation/auth";
import { AuthCard, FloatingInput } from "./auth-parts";

type Status = "idle" | "sending" | "sent";
type FormError = "invalidEmail" | "rateLimited" | "emailUnavailable" | "generic";

/** Step 1 of the reset flow: ask for the email, then confirm a link was sent. */
export function ForgotPasswordForm({ showDevHint }: { showDevHint: boolean }) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<FormError | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) return setError("invalidEmail");

    setError(null);
    setStatus("sending");
    try {
      const res = await fetch("/api/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: parsed.data }),
      });
      if (res.ok) return setStatus("sent");
      setError(res.status === 429 ? "rateLimited" : res.status === 503 ? "emailUnavailable" : "generic");
    } catch {
      setError("generic");
    }
    setStatus("idle");
  }

  if (status === "sent") {
    return (
      <AuthCard
        icon={<MailCheck strokeWidth={1.25} />}
        title={t("auth.reset.sentTitle")}
        description={
          <>
            <p>{t("auth.reset.sentBody", { email: email.trim() })}</p>
            {showDevHint && <p className="mt-3 rounded-card bg-secondary-bg px-3 py-2 text-caption">{t("auth.reset.devHint")}</p>}
          </>
        }
      />
    );
  }

  return (
    <AuthCard icon={<Lock strokeWidth={1.25} />} title={t("auth.reset.troubleTitle")} description={t("auth.reset.troubleBody")}>
      <form onSubmit={submit} noValidate className="space-y-3">
        <FloatingInput
          name="email"
          type="email"
          autoComplete="email"
          label={t("auth.email")}
          value={email}
          onChange={setEmail}
          invalid={error === "invalidEmail"}
          autoFocus
        />
        <Button type="submit" className="w-full" disabled={!email.trim() || status === "sending"} aria-busy={status === "sending"}>
          {status === "sending" ? <Loader2 className="size-4 animate-spin" aria-label={t("auth.reset.sending")} /> : t("auth.reset.sendLink")}
        </Button>
        {error && (
          <p role="alert" className="text-center text-body text-danger">
            {t(`auth.reset.errors.${error}`)}
          </p>
        )}
      </form>
    </AuthCard>
  );
}
