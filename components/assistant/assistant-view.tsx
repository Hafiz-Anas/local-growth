"use client";

import { PageHeader } from "@/components/shared/page-header";
import { useI18n } from "@/lib/i18n/provider";
import { AssistantChat } from "./assistant-chat";

export function AssistantView() {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("assistant.title")} subtitle={t("assistant.subtitle")} />
      <AssistantChat />
    </div>
  );
}
