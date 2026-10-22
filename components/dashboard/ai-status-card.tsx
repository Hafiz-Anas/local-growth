"use client";

import Link from "next/link";
import { AlertTriangle, Bot, FileText, Lightbulb, Sparkles } from "lucide-react";
import { useAssistantPanel } from "@/components/assistant/assistant-panel";
import { MetaConnectButton } from "@/components/instagram/meta-connect";
import { useActiveClient, useFeature } from "@/components/providers/active-client-provider";
import { Skeleton } from "@/components/shared/states";
import { TimeAgo } from "@/components/shared/time-ago";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAiStatus } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { cn, formatNumber } from "@/lib/utils";
import type { AiStatusDto } from "@/types";

const HEALTH_BADGE = { healthy: "success", demo: "blue", needs_reconnect: "danger", permissions: "warning", disconnected: "neutral" } as const;

/**
 * Slim "AI status" card: which Instagram account the AI features work from, how much they see,
 * how fresh it is, what needs attention, and links to the AI modules this client has. Shown only
 * when at least one AI module is on; reads stored data only.
 */
export function AiStatusCard({ className }: { className?: string }) {
  const { t, locale } = useI18n();
  const { isPreview } = useActiveClient();
  const assistant = useFeature("assistant");
  const recommendations = useFeature("recommendations");
  const reports = useFeature("reports");
  const openAssistant = useAssistantPanel((s) => s.setOpen);
  const enabled = assistant || recommendations;
  const status = useAiStatus(enabled);
  if (!enabled || isPreview) return null;
  if (status.isPending) return <Skeleton className={cn("mb-8 h-28 rounded-panel", className)} />;
  if (status.isError) return null;

  const { account, coverage, freshness } = status.data;
  // Missing permissions are shown only as a tag in Settings, never here.
  const warnings = status.data.warnings.filter((w) => w !== "permissions");
  const health = account.health === "permissions" ? "healthy" : account.health;
  const never = t("aiStatus.never");
  return (
    <section className={cn("mb-8 rounded-panel border border-border p-4", className)} aria-labelledby="ai-status-title" data-testid="ai-status">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Sparkles className="size-5 shrink-0" aria-hidden="true" />
        <h2 id="ai-status-title" className="text-title font-bold">
          {t("aiStatus.title")}
        </h2>
        <Badge variant={HEALTH_BADGE[health]} className="ms-auto">
          {t(`aiStatus.health.${health}`)}
        </Badge>
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={t("aiStatus.account")}>{account.username ? <bdi>@{account.username}</bdi> : t("aiStatus.noAccount")}</Stat>
        <Stat label={t("aiStatus.coverage")}>
          <span className="block">{coverage.postsAnalyzed === null ? t("aiStatus.noPosts") : t("aiStatus.posts", { count: formatNumber(coverage.postsAnalyzed, locale) })}</span>
          {coverage.competitorsTracked !== null && <span className="block">{t("aiStatus.competitors", { count: formatNumber(coverage.competitorsTracked, locale) })}</span>}
        </Stat>
        <Stat label={t("aiStatus.freshness")}>
          <span className="block">
            {t("aiStatus.synced")}{" "}
            {freshness.lastSyncAt ? <TimeAgo iso={freshness.lastSyncAt} /> : account.health === "demo" ? t("aiStatus.demoData") : never}
          </span>
          {recommendations && (
            <span className="block">
              {t("aiStatus.analysed")} {freshness.lastAnalysisAt ? <TimeAgo iso={freshness.lastAnalysisAt} /> : never}
            </span>
          )}
        </Stat>
      </dl>

      {warnings.length > 0 && <Warnings warnings={warnings} account={account} />}

      <div className="mt-3 flex flex-wrap gap-2">
        {assistant && (
          <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => openAssistant(true)}>
            <Bot className="size-4" aria-hidden="true" />
            {t("nav.assistant")}
          </Button>
        )}
        {recommendations && (
          <Button asChild variant="secondary" size="sm" className="gap-1.5">
            <Link href="/recommendations">
              <Lightbulb className="size-4" aria-hidden="true" />
              {t("nav.recommendations")}
            </Link>
          </Button>
        )}
        {reports && (
          <Button asChild variant="secondary" size="sm" className="gap-1.5">
            <Link href="/reports">
              <FileText className="size-4" aria-hidden="true" />
              {t("nav.reports")}
            </Link>
          </Button>
        )}
      </div>
    </section>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="text-body font-semibold break-words">{children}</dd>
    </div>
  );
}

/** The most important problem first, with the action that fixes it. */
function Warnings({ warnings, account }: { warnings: AiStatusDto["warnings"]; account: AiStatusDto["account"] }) {
  const { t } = useI18n();
  const main = warnings[0];
  const meta = account.provider === "meta";
  const action =
    main === "reconnect" ? (
      meta ? (
        <MetaConnectButton returnTo="settings" size="sm" label={t("aiStatus.reconnect")} className="h-8" />
      ) : (
        <Button asChild size="sm">
          <Link href="/settings#instagram">{t("aiStatus.reconnect")}</Link>
        </Button>
      )
    ) : main === "not_connected" ? (
      <Button asChild size="sm">
        <Link href="/settings#instagram">{t("aiStatus.connect")}</Link>
      </Button>
    ) : null;
  return (
    <div role="alert" className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card bg-danger/8 px-3 py-2 text-caption">
      <AlertTriangle className="size-4 shrink-0 text-danger" aria-hidden="true" />
      <p className="min-w-0 flex-1">{warnings.map((w) => t(`aiStatus.warnings.${w}`)).join(" ")}</p>
      {action}
    </div>
  );
}
