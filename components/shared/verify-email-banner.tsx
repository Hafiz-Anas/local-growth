"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, MailWarning } from "lucide-react";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { notify } from "@/store/ui-store";

/**
 * Shown until the address is verified; "Resend verification email" sends a new
 * link (3 per 15 minutes). `sendFailed`: sign-up could not send the first email.
 */
export function VerifyEmailBanner({ email, sendFailed = false, className }: { email?: string; sendFailed?: boolean; className?: string }) {
  const { t } = useI18n();
  const [sent, setSent] = useState(false);
  const resend = useMutation<{ sent: boolean }, ApiClientError>({
    mutationFn: () => apiFetch("/api/me/verify-email", { method: "POST" }),
    meta: { handlesErrors: true },
    onSuccess: () => {
      setSent(true);
      notify.success(t("verifyEmail.banner.sent"));
    },
    onError: (error) => notify.error(errorMessage(error, t)),
  });

  return (
    <div role="status" className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 bg-warning/12 px-4 py-2 text-caption md:px-8", className)}>
      <MailWarning className="size-4 shrink-0 text-warning" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">{t("verifyEmail.banner.title")}</span>{" "}
        {sendFailed && !sent
          ? t("verifyEmail.banner.notSent")
          : email
            ? t("verifyEmail.banner.bodyWithEmail", { email })
            : t("verifyEmail.banner.body")}
      </p>
      <button
        type="button"
        onClick={() => resend.mutate()}
        disabled={resend.isPending || sent}
        className="inline-flex items-center gap-1 font-semibold text-primary hover:text-link disabled:opacity-60"
      >
        {resend.isPending && <Loader2 className="size-3.5 animate-spin" />}
        {sent ? t("verifyEmail.banner.resent") : t("verifyEmail.banner.resend")}
      </button>
    </div>
  );
}
