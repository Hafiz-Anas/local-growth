"use client";

import Link from "next/link";
import { MailCheck, MailX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";
import type { VerifyResult } from "@/lib/server/email-verification";
import { AuthCard } from "./auth-parts";

/** Outcome of opening the emailed verification link. */
export function VerifyEmailResult({ result, signedIn }: { result: VerifyResult; signedIn: boolean }) {
  const { t } = useI18n();
  const ok = result !== "invalid";
  return (
    <AuthCard
      icon={ok ? <MailCheck strokeWidth={1.25} /> : <MailX strokeWidth={1.25} />}
      title={t(`verifyEmail.${result}.title`)}
      description={t(`verifyEmail.${result}.body`)}
    >
      <Button asChild className="w-full">
        <Link href={signedIn ? "/dashboard" : "/login"}>{signedIn ? t("verifyEmail.continue") : t("auth.login")}</Link>
      </Button>
    </AuthCard>
  );
}
