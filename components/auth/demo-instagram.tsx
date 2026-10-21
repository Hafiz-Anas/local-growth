"use client";

import { useEffect, useState } from "react";
import { AtSign, Camera, Loader2 } from "lucide-react";
import { HANDLE_PATTERN, normalizeHandle } from "@/components/competitors/helpers";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { AuthFooter } from "./auth-parts";

const CALLBACK = "/api/integrations/instagram/callback";

/**
 * Stands in for Facebook Login while INSTAGRAM_PROVIDER=mock (demo and e2e): "log in" with a handle and
 * allow, or cancel — both go to the same callback as Meta's dialog, with the sign-up's state.
 */
export function DemoInstagram({ state }: { state: string }) {
  const { t } = useI18n();
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  // Back here with the browser's back button (page restored from cache): enable the button again.
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => event.persisted && setLeaving(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);
  const value = normalizeHandle(handle);
  const cancelHref = `${CALLBACK}?${new URLSearchParams({ state, error: "access_denied", error_reason: "user_denied" })}`;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    if (!HANDLE_PATTERN.test(value)) {
      event.preventDefault();
      setError(t("competitors.invalidHandle"));
      return;
    }
    setLeaving(true);
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <main className="flex flex-1 items-start justify-center px-4 py-8 sm:items-center sm:py-12">
        <div className="w-full max-w-[350px] border-border px-4 pt-8 pb-6 sm:rounded-[1px] sm:border sm:px-10 sm:pt-10">
          <div className="mb-3 flex justify-center">
            <Logo className="[&_svg]:size-9 [&>span]:text-[30px]" />
          </div>
          <div className="mb-5 flex flex-col items-center gap-2 text-center">
            <span className="flex size-12 items-center justify-center rounded-pill border-2 border-foreground">
              <Camera className="size-6" strokeWidth={1.5} aria-hidden="true" />
            </span>
            <h1 className="text-title font-semibold">{t("signup.demo.title")}</h1>
            <p className="text-caption text-muted">{t("signup.demo.body")}</p>
          </div>

          <form method="get" action={CALLBACK} onSubmit={submit} noValidate>
            <input type="hidden" name="state" value={state} />
            <input type="hidden" name="mock_handle" value={value} />
            <label htmlFor="demo-handle" className="mb-1.5 block text-body font-semibold">
              {t("onboarding.instagram.handle")}
            </label>
            <div className="relative">
              <AtSign className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <Input
                id="demo-handle"
                value={handle}
                onChange={(e) => {
                  setHandle(e.target.value);
                  setError(null);
                }}
                placeholder="yourbusiness.kw"
                dir="ltr"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={Boolean(error) || undefined}
                className={cn("ps-9", error && "border-danger")}
              />
            </div>
            {error && (
              <p role="alert" className="mt-2 text-caption text-danger">
                {error}
              </p>
            )}
            <Button type="submit" className="mt-3 w-full" disabled={!handle.trim() || leaving}>
              {leaving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {t("signup.demo.allow")}
            </Button>
          </form>
          <Button asChild variant="ghost" className="mt-2 w-full">
            <a href={cancelHref}>{t("signup.demo.cancel")}</a>
          </Button>
          <p className="mt-4 text-center text-caption text-muted">{t("onboarding.instagram.mockNote")}</p>
        </div>
      </main>
      <AuthFooter />
    </div>
  );
}
