"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { InfoDialog } from "@/components/ui/dialog";
import type { Locale } from "@/config/site";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/** Instagram's login field: gray fill, thin border, label shrinks to the top while typing. */
export function FloatingInput({
  label,
  value,
  onChange,
  trailing,
  invalid,
  ...props
}: Omit<React.ComponentProps<"input">, "onChange" | "value"> & {
  label: string;
  value: string;
  onChange: (value: string) => void;
  trailing?: React.ReactNode;
  invalid?: boolean;
}) {
  const filled = value.length > 0;
  return (
    <label className="flex h-[38px] items-center rounded-[3px] border border-border bg-input transition-colors focus-within:border-muted">
      <span className="relative h-full flex-1">
        <span
          className={cn(
            "pointer-events-none absolute start-2 truncate text-muted transition-all duration-100",
            filled ? "top-1 text-[10px] leading-3" : "top-1/2 -translate-y-1/2 text-caption",
          )}
        >
          {label}
        </span>
        <input
          {...props}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          aria-invalid={invalid || undefined}
          className={cn("h-full w-full bg-transparent px-2 text-caption outline-none", filled && "pt-3.5 pb-0.5")}
        />
      </span>
      {trailing}
    </label>
  );
}

/** "Show" / "Hide" toggle shown inside a password field once it has a value. */
export function ShowPasswordToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  return (
    <button type="button" onClick={onToggle} className="pe-2 text-body font-semibold text-foreground hover:text-muted" aria-pressed={shown}>
      {shown ? t("auth.hide") : t("auth.show")}
    </button>
  );
}

type FooterKey = "about" | "help" | "privacy" | "terms";
const FOOTER_LINKS: FooterKey[] = ["about", "help", "privacy", "terms"];

/** Footer links, language picker and copyright under the auth screens. */
export function AuthFooter() {
  const { t, locale, setLocale } = useI18n();
  const [info, setInfo] = useState<FooterKey | null>(null);
  return (
    <footer className="px-4 pb-8 text-caption text-muted">
      <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        {FOOTER_LINKS.map((key) => (
          <button key={key} type="button" onClick={() => setInfo(key)} className="hover:underline">
            {t(`auth.footer.${key}`)}
          </button>
        ))}
        <label className="relative inline-flex items-center gap-1">
          <span className="sr-only">{t("settings.preferences.language")}</span>
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
            className="cursor-pointer appearance-none bg-transparent pe-4 text-caption text-muted outline-none hover:text-foreground"
          >
            <option value="en">English</option>
            <option value="ar">العربية</option>
          </select>
          <ChevronDown className="pointer-events-none absolute end-0 size-3" aria-hidden="true" />
        </label>
      </nav>
      <p className="mt-3 text-center">{t("auth.copyright")}</p>

      <InfoDialog
        open={info !== null}
        onOpenChange={(open) => !open && setInfo(null)}
        title={info ? t(`auth.info.${info}.title`) : ""}
        description={info ? t(`auth.info.${info}.body`) : ""}
        actionLabel={t("common.close")}
      />
    </footer>
  );
}

/**
 * Instagram's "Trouble logging in?" layout: a narrow bordered card with a round
 * outlined icon, then a "Back to login" bar attached underneath.
 */
export function AuthCard({ icon, title, description, children }: { icon: ReactNode; title: string; description?: ReactNode; children?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="flex flex-1 items-start justify-center px-4 py-8 sm:items-center sm:py-12">
        <div className="w-full max-w-[388px] border-border sm:rounded-[1px] sm:border">
          <div className="px-6 pt-6 pb-4 text-center sm:px-11">
            <span className="mx-auto mb-4 flex size-24 items-center justify-center rounded-pill border-2 border-foreground [&_svg]:size-11">
              {icon}
            </span>
            <h1 className="text-title font-semibold">{title}</h1>
            {description && <div className="mt-2.5 text-body text-muted">{description}</div>}
            <div className="mt-4 text-start">{children}</div>
          </div>
          <Link
            href="/login"
            className="block border-t border-border bg-secondary-bg py-3.5 text-center text-body font-semibold hover:text-muted sm:rounded-b-[1px]"
          >
            {t("auth.backToLogin")}
          </Link>
        </div>
      </main>
      <AuthFooter />
    </div>
  );
}
