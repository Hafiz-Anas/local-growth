"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/provider";

/** Instagram's "Sorry, this page isn't available." screen. */
export function NotAvailable({ homeHref = "/" }: { homeHref?: string }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-heading font-bold">{t("notFound.title")}</h1>
      <p className="mt-6 text-title">
        {t("notFound.body")}{" "}
        <Link href={homeHref} className="text-link hover:underline">
          {t("notFound.back")}
        </Link>
      </p>
    </div>
  );
}
