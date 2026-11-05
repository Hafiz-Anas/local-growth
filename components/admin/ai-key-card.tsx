"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Loader2, XCircle } from "lucide-react";
import { ErrorState, Skeleton } from "@/components/shared/states";
import { TimeAgo } from "@/components/shared/time-ago";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAdminAiKey } from "@/lib/api/admin";
import { apiFetch, type ApiClientError } from "@/lib/api/client";
import { qk } from "@/lib/api/queries";
import { useI18n } from "@/lib/i18n/provider";
import { keyProblem, maskedKey } from "@/lib/services/ai-key-format";
import { notify } from "@/store/ui-store";
import type { AiKeyStatusDto, AiKeyTestDto } from "@/types";

type Scope = { kind: "platform" } | { kind: "business"; businessId: string };

const KNOWN_REASONS = ["invalid_key", "billing", "daily_limit", "rate_limited", "region", "model_unavailable", "request_rejected", "unavailable", "not_configured"];

/**
 * Admin: the Gemini API key for the whole platform (System page) or for one client (its page). The browser only
 * ever gets the last 4 characters; the key is typed here, sent once and stored encrypted. "Test key" makes one
 * small Gemini call with what is typed, or with the key in use when the field is empty.
 */
export function AiKeyCard({ scope }: { scope: Scope }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const businessId = scope.kind === "business" ? scope.businessId : undefined;
  const query = useAdminAiKey(businessId);
  const base = businessId ? `/api/admin/businesses/${businessId}/ai-key` : "/api/admin/ai-settings";
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<AiKeyTestDto | null>(null);

  const refreshed = (data: AiKeyStatusDto) => {
    queryClient.setQueryData(qk.admin.aiKey(businessId), data);
    setValue("");
    setProblem(null);
    setResult(null);
  };
  const save = useMutation<AiKeyStatusDto, ApiClientError, string>({
    mutationFn: (apiKey) => apiFetch(base, { method: "PUT", body: { apiKey } }),
    onSuccess: (data) => {
      refreshed(data);
      notify.success(t("admin.aiKey.saveDone"));
    },
  });
  const remove = useMutation<AiKeyStatusDto, ApiClientError>({
    mutationFn: () => apiFetch(base, { method: "DELETE" }),
    onSuccess: (data) => {
      refreshed(data);
      notify.success(t("admin.aiKey.removeDone"));
    },
  });
  const test = useMutation<AiKeyTestDto, ApiClientError, string>({
    mutationFn: (apiKey) => apiFetch("/api/admin/ai-keys/test", { method: "POST", body: { ...(apiKey && { apiKey }), ...(businessId && { businessId }) } }),
    onSuccess: setResult,
  });

  const typed = value.trim();
  const submit = () => {
    const found = keyProblem(typed);
    if (found) return setProblem(found);
    setProblem(null);
    save.mutate(typed);
  };
  const runTest = () => {
    const found = typed ? keyProblem(typed) : null;
    if (found) return setProblem(found);
    setProblem(null);
    setResult(null);
    test.mutate(typed);
  };

  const status = query.data;
  const prefix = scope.kind === "platform" ? "platform" : "client";
  const reason = result?.reason && KNOWN_REASONS.includes(result.reason) ? result.reason : "other";
  return (
    <Card className="mb-6" data-testid={`ai-key-${scope.kind}`}>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-5" aria-hidden="true" />
            {t(`admin.aiKey.${prefix}Title`)}
          </CardTitle>
          <CardDescription>{t(`admin.aiKey.${prefix}Hint`)}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {query.isPending && <Skeleton className="h-24 w-full" />}
        {query.isError && <ErrorState error={query.error} onRetry={() => query.refetch()} />}
        {status && (
          <div className="space-y-4">
            <dl className="grid gap-1.5 text-body sm:grid-cols-[max-content_1fr] sm:gap-x-6">
              <dt className="text-muted">{t("admin.aiKey.inUse")}</dt>
              <dd data-testid="ai-key-source" className="font-semibold">
                {t(`admin.aiKey.sources.${status.effective.source}`)}
                {status.effective.last4 && (
                  <span className="ms-2 font-mono text-caption font-normal text-muted" dir="ltr">
                    {maskedKey(status.effective.last4)}
                  </span>
                )}
              </dd>
              <dt className="text-muted">{t("admin.aiKey.label")}</dt>
              <dd data-testid="ai-key-saved">
                {status.set && status.last4 ? (
                  <>
                    {t("admin.aiKey.saved", { last4: status.last4 })}
                    {status.updatedAt && (
                      <span className="ms-2 text-caption text-muted">
                        {status.updatedByName ? t("admin.aiKey.changed", { name: status.updatedByName }) : t("admin.aiKey.changedUnknown")} · <TimeAgo iso={status.updatedAt} />
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-muted">{t("admin.aiKey.notSaved")}</span>
                )}
              </dd>
              {scope.kind === "platform" && (
                <>
                  <dt className="text-muted">GEMINI_API_KEY</dt>
                  <dd className="text-muted">{status.envConfigured ? t("admin.aiKey.envSet") : t("admin.aiKey.envMissing")}</dd>
                </>
              )}
            </dl>

            {!status.encryptionReady && (
              <p role="alert" data-testid="ai-key-encryption" className="rounded-card bg-danger/10 px-3 py-2 text-body text-danger">
                {t("admin.aiKey.encryptionMissing")}
              </p>
            )}

            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <Label htmlFor={`ai-key-input-${scope.kind}`}>{t("admin.aiKey.label")}</Label>
              <Input
                id={`ai-key-input-${scope.kind}`}
                data-testid="ai-key-input"
                type="password"
                autoComplete="off"
                spellCheck={false}
                dir="ltr"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setProblem(null);
                }}
                placeholder={t("admin.aiKey.placeholder")}
                aria-invalid={problem ? true : undefined}
                aria-describedby={`ai-key-note-${scope.kind}`}
              />
              {problem && (
                <p role="alert" data-testid="ai-key-problem" className="text-caption text-danger">
                  {t(`admin.aiKey.problems.${problem}`)}
                </p>
              )}
              <p id={`ai-key-note-${scope.kind}`} className="text-caption text-muted">
                {t("admin.aiKey.onlyLast4")} {t("admin.aiKey.testTyped")}
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button type="submit" disabled={!typed || save.isPending || !status.encryptionReady} data-testid="ai-key-save">
                  {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                  {t("admin.aiKey.save")}
                </Button>
                <Button type="button" variant="secondary" onClick={runTest} disabled={test.isPending} data-testid="ai-key-test">
                  {test.isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                  {test.isPending ? t("admin.aiKey.testing") : t("admin.aiKey.test")}
                </Button>
                {status.set && (
                  <Button type="button" variant="ghost" className="text-danger" onClick={() => remove.mutate()} disabled={remove.isPending} data-testid="ai-key-remove">
                    {t("admin.aiKey.remove")}
                  </Button>
                )}
              </div>
            </form>

            {result && (
              <p
                role="status"
                data-testid="ai-key-result"
                className={`flex items-start gap-2 rounded-card px-3 py-2 text-body ${result.ok ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}
              >
                {result.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
                <span>{result.ok ? t("admin.aiKey.testOk") : t("admin.aiKey.testFail", { reason: t(`admin.aiKey.reasons.${reason}`) })}</span>
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
