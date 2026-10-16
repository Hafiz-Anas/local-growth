"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, ChevronRight, MessageSquareWarning, Rocket } from "lucide-react";
import { Avatar } from "@/components/shared/avatar";
import { PlanBadge } from "@/components/shared/client-row";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState, Skeleton, SkeletonList } from "@/components/shared/states";
import { StatTile } from "@/components/shared/stat-tile";
import { TimeAgo } from "@/components/shared/time-ago";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ONBOARDING_STEPS, PROGRESS_STEPS, stepNumber } from "@/config/onboarding";
import { useAdminOnboarding } from "@/lib/api/admin";
import { useI18n } from "@/lib/i18n/provider";
import { cn, initials, toneFor } from "@/lib/utils";
import type { AdminOnboardingBusinessDto } from "@/types";
import { IntegrationLog } from "./integration-card";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** 45s · 3m 12s · 1h 5m */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** One readable line for an ERROR event's details ({ kind, reason | code, handle, … }). */
function describeError(details: unknown, t: Translate): string {
  const d = (details && typeof details === "object" ? details : {}) as Record<string, unknown>;
  const kind = typeof d.kind === "string" ? d.kind : typeof d.reason === "string" ? "step" : "error";
  const reason = [d.reason, d.code].find((v): v is string => typeof v === "string");
  const kindText = t(`adminOnboarding.kinds.${kind}`);
  const reasonText = reason ? t(`adminOnboarding.reasons.${reason}`) : "";
  const parts = [
    kindText.startsWith("adminOnboarding.") ? kind : kindText,
    reason && (reasonText.startsWith("adminOnboarding.") ? reason : reasonText),
    typeof d.handle === "string" ? `@${d.handle}` : null,
    Array.isArray(d.fields) ? (d.fields as unknown[]).map((f) => (typeof f === "string" ? f : (f as { path?: string })?.path)).filter(Boolean).join(", ") : null,
    Array.isArray(d.missing) ? (d.missing as string[]).join(", ") : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

/** Admin: every self sign-up (and invited client), where they are, how long each step took, errors and feedback. */
export function OnboardingAdminView() {
  const { t } = useI18n();
  const query = useAdminOnboarding();

  return (
    <div>
      <PageHeader title={t("adminOnboarding.title")} subtitle={t("adminOnboarding.subtitle")} />

      {query.isPending ? (
        <div aria-busy="true">
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-[88px] rounded-panel" />
            ))}
          </div>
          <Skeleton className="mb-6 h-72 rounded-panel" />
          <SkeletonList rows={3} className="rounded-panel border border-border" />
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatTile icon={Rocket} label={t("adminOnboarding.totals.signups")} value={query.data.totals.signups} />
            <StatTile
              icon={Rocket}
              label={t("adminOnboarding.totals.completed")}
              value={`${query.data.totals.completed}${query.data.totals.signups ? ` · ${Math.round((query.data.totals.completed / query.data.totals.signups) * 100)}%` : ""}`}
            />
            <StatTile icon={Rocket} label={t("adminOnboarding.totals.inProgress")} value={query.data.totals.inProgress} />
            <StatTile icon={AlertTriangle} label={t("adminOnboarding.totals.withErrors")} value={query.data.totals.withErrors} accent={query.data.totals.withErrors > 0} />
            <StatTile icon={MessageSquareWarning} label={t("adminOnboarding.totals.feedback")} value={query.data.totals.feedback} accent={query.data.totals.feedback > 0} />
          </div>

          <Card className="mb-6">
            <CardHeader>
              <div>
                <CardTitle>{t("adminOnboarding.funnel")}</CardTitle>
                <CardDescription>{t("adminOnboarding.funnelHint")}</CardDescription>
              </div>
            </CardHeader>
            <ol className="space-y-2.5 px-4 pb-4">
              {query.data.funnel.map(({ step, reached }) => {
                const total = query.data.funnel[0]?.reached ?? 0;
                const pct = total ? Math.round((reached / total) * 100) : 0;
                return (
                  <li key={step} className="grid grid-cols-[minmax(0,140px)_1fr_72px] items-center gap-3">
                    <span className="truncate text-caption font-semibold">{t(`adminOnboarding.funnelSteps.${step}`)}</span>
                    <span className="h-2.5 overflow-hidden rounded-pill bg-secondary-bg" aria-hidden="true">
                      <span className={cn("block h-full rounded-pill", step === "completed" ? "bg-success" : "bg-primary")} style={{ width: `${pct}%` }} />
                    </span>
                    <span className="text-end text-caption text-muted tabular-nums">
                      {reached} · {pct}%
                    </span>
                  </li>
                );
              })}
            </ol>
          </Card>

          <h2 className="mb-3 text-title font-bold">{t("adminOnboarding.businesses")}</h2>
          {query.data.businesses.length === 0 ? (
            <EmptyState icon={Rocket} title={t("adminOnboarding.emptyTitle")} hint={t("adminOnboarding.emptyHint")} className="rounded-panel border border-border" />
          ) : (
            <ul className="space-y-3">
              {query.data.businesses.map((b) => (
                <BusinessRow key={b.id} business={b} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function BusinessRow({ business: b }: { business: AdminOnboardingBusinessDto }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(b.feedback.length > 0 || (b.status === "in_progress" && b.errorCount > 0));
  const n = Math.min(stepNumber(b.step), PROGRESS_STEPS.length);
  const totalMs = Object.values(b.timePerStep).reduce((sum, ms) => sum + (ms ?? 0), 0);
  const maxMs = Math.max(1, ...Object.values(b.timePerStep).map((ms) => ms ?? 0));

  return (
    <li className="overflow-hidden rounded-panel border border-border">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-hover">
        <Avatar src={b.avatarUrl} initials={initials(b.name)} tone={toneFor(b.id)} size="md" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-body font-semibold">{b.name}</span>
            <Badge variant={b.source === "self_signup" ? "outline" : "neutral"} size="sm">
              {b.source === "self_signup" ? t("adminOnboarding.selfSignup") : b.source === "account_added" ? t("adminOnboarding.accountAdded") : t("adminOnboarding.invited")}
            </Badge>
            <PlanBadge plan={b.plan} />
          </span>
          <span className="mt-0.5 block truncate text-caption text-muted">
            {b.owner ? <bdi>{b.owner.email}</bdi> : "—"}
            {b.owner && !b.owner.emailVerified && <span className="ms-1.5 text-warning">· {t("adminOnboarding.unverified")}</span>}
            {" · "}
            {t("adminOnboarding.signedUp")} <TimeAgo iso={b.createdAt} />
            {b.lastEventAt && (
              <>
                {" · "}
                {t("adminOnboarding.lastSeen")} <TimeAgo iso={b.lastEventAt} />
              </>
            )}
          </span>
        </span>
        <span className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
          {b.status === "completed" ? (
            <Badge variant="success">{t("adminOnboarding.completed")}</Badge>
          ) : (
            <Badge variant="blue">{t("adminOnboarding.atStep", { n, total: PROGRESS_STEPS.length, name: t(`onboarding.steps.${b.step}.short`) })}</Badge>
          )}
          <span className="flex gap-1">
            {b.errorCount > 0 && <Badge variant="danger" size="sm">{t("adminOnboarding.errorCount", { count: b.errorCount })}</Badge>}
            {b.feedback.length > 0 && <Badge variant="warning" size="sm">{t("adminOnboarding.feedbackCount", { count: b.feedback.length })}</Badge>}
          </span>
        </span>
        {open ? <ChevronDown className="size-5 shrink-0 text-muted" /> : <ChevronRight className="size-5 shrink-0 text-muted rtl:-scale-x-100" />}
      </button>

      {open && (
        <div className="grid gap-5 border-t border-separator px-4 py-4 lg:grid-cols-3">
          <section>
            <h3 className="mb-2 text-caption font-semibold text-muted">
              {t("adminOnboarding.timePerStep")} {totalMs > 0 && `· ${formatDuration(totalMs)}`}
            </h3>
            <ul className="space-y-1.5">
              {ONBOARDING_STEPS.map((step) => {
                const ms = b.timePerStep[step];
                const reached = stepNumber(step) <= stepNumber(b.reached);
                return (
                  <li key={step} className={cn("grid grid-cols-[96px_1fr_64px] items-center gap-2 text-caption", !reached && "opacity-40")}>
                    <span className={cn("truncate", step === b.step && b.status === "in_progress" && "font-semibold text-primary")}>{t(`onboarding.steps.${step}.short`)}</span>
                    <span className="h-1.5 overflow-hidden rounded-pill bg-secondary-bg" aria-hidden="true">
                      {ms ? <span className="block h-full rounded-pill bg-foreground/70" style={{ width: `${Math.max(4, (ms / maxMs) * 100)}%` }} /> : null}
                    </span>
                    <span className="text-end text-muted tabular-nums">{ms ? formatDuration(ms) : "—"}</span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section>
            <h3 className="mb-2 text-caption font-semibold text-muted">{t("adminOnboarding.errors")}</h3>
            {b.errors.length === 0 ? (
              <p className="text-caption text-muted">{t("adminOnboarding.noErrors")}</p>
            ) : (
              <ul className="max-h-64 space-y-1.5 overflow-y-auto">
                {b.errors.map((e) => (
                  <li key={e.id} className="rounded-button bg-danger/6 px-2.5 py-1.5 text-caption">
                    <span className="font-semibold">{t(`adminOnboarding.eventSteps.${e.step}`)}</span> · {describeError(e.details, t)}
                    <span className="block text-muted">
                      <TimeAgo iso={e.createdAt} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-caption font-semibold text-muted">{t("adminOnboarding.feedback")}</h3>
            {b.feedback.length === 0 ? (
              <p className="text-caption text-muted">{t("adminOnboarding.noFeedback")}</p>
            ) : (
              <ul className="max-h-64 space-y-2 overflow-y-auto">
                {b.feedback.map((f) => (
                  <li key={f.id} className="rounded-button border border-border px-2.5 py-2 text-caption">
                    <p className="whitespace-pre-line" dir="auto">
                      {f.note}
                    </p>
                    <p className="mt-1 text-muted">
                      {t(`adminOnboarding.eventSteps.${f.step}`)} · {f.userName ?? "—"} · <TimeAgo iso={f.createdAt} />
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {b.integrationEvents.length > 0 && (
            <section className="lg:col-span-3">
              <h3 className="mb-2 text-caption font-semibold text-muted">{t("admin.integration.log")}</h3>
              <IntegrationLog events={b.integrationEvents} compact />
            </section>
          )}

          <div className="lg:col-span-3">
            <Link href={`/admin/clients/${b.id}`} className="text-caption font-semibold text-primary hover:text-link">
              {t("adminOnboarding.openClient")}
            </Link>
          </div>
        </div>
      )}
    </li>
  );
}
