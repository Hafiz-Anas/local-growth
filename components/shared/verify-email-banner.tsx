"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, Loader2, MailWarning } from "lucide-react";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { notify } from "@/store/ui-store";

const CHANNEL = "lge-email-verified";
const POLL_MS = 30_000;
const VERIFIED_SHOWN_MS = 5_000;
const FADE_MS = 300;

/** Tells this browser's other tabs that a verification link was just opened (they re-check at once). */
export function announceEmailVerified() {
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage("verified");
    channel.close();
  } catch {
    // No BroadcastChannel: the other tabs still notice on focus or on the next poll.
  }
}

/** Plain fetch, not apiFetch: a background check must never redirect or show a toast. */
async function fetchVerified(): Promise<boolean> {
  const res = await fetch("/api/me/verify-email", { cache: "no-store" });
  if (!res.ok) throw new Error(`verify status ${res.status}`);
  const body = (await res.json()) as { data?: { verified?: boolean } };
  return body.data?.verified === true;
}

/**
 * Shown while `unverified`; "Resend verification email" sends a new link (3 per
 * 15 minutes). It re-checks the address when the tab regains focus, every 30
 * seconds while visible, and right away when another tab opens the link, so it
 * turns into "Your email has been verified" without a reload (also when the
 * link was opened on another device), then fades out. Once mounted it stays
 * until that message is done, even if the parent's data turns verified first.
 * `sendFailed`: sign-up could not send the first email.
 */
export function VerifyEmailBanner({
  unverified,
  ...props
}: {
  unverified: boolean;
  email?: string;
  sendFailed?: boolean;
  className?: string;
}) {
  const [seen, setSeen] = useState(unverified);
  const [done, setDone] = useState(false);
  const finish = useCallback(() => setDone(true), []);
  if (unverified && !seen) setSeen(true);
  if (!seen || done) return null;
  return <Banner {...props} onDone={finish} />;
}

function Banner({ email, sendFailed = false, className, onDone }: { email?: string; sendFailed?: boolean; className?: string; onDone: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [sent, setSent] = useState(false);
  const [alreadyVerified, setAlreadyVerified] = useState(false);
  const [fading, setFading] = useState(false);

  const status = useQuery({
    queryKey: [...qk.me, "email-verified"],
    queryFn: fetchVerified,
    enabled: !alreadyVerified,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (query.state.data ? false : POLL_MS),
  });
  const verified = alreadyVerified || status.data === true;

  // Another tab opened the link: check now instead of waiting for focus or the next poll.
  const { refetch } = status;
  useEffect(() => {
    if (verified || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = () => void refetch();
    return () => channel.close();
  }, [verified, refetch]);

  useEffect(() => {
    if (!verified) return;
    void queryClient.invalidateQueries({ queryKey: qk.me, exact: true });
    void queryClient.invalidateQueries({ queryKey: qk.onboarding });
    const fade = setTimeout(() => setFading(true), VERIFIED_SHOWN_MS);
    const hide = setTimeout(onDone, VERIFIED_SHOWN_MS + FADE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(hide);
    };
  }, [verified, queryClient, onDone]);

  const resend = useMutation<{ sent: boolean }, ApiClientError>({
    mutationFn: () => apiFetch("/api/me/verify-email", { method: "POST" }),
    meta: { handlesErrors: true },
    onSuccess: () => {
      setSent(true);
      notify.success(t("verifyEmail.banner.sent"));
    },
    onError: (error) => {
      if (error.status === 409) setAlreadyVerified(true);
      else notify.error(errorMessage(error, t));
    },
  });

  const base = "flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-caption transition-opacity duration-300 md:px-8";

  if (verified) {
    return (
      <div role="status" className={cn(base, "bg-success/12", fading && "opacity-0", className)}>
        <CircleCheck className="size-4 shrink-0 text-success" aria-hidden="true" />
        <p className="min-w-0 flex-1 font-semibold">{t("verifyEmail.banner.verified")}</p>
      </div>
    );
  }

  return (
    <div role="status" className={cn(base, "bg-warning/12", className)}>
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
