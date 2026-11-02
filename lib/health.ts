/**
 * Health checks for Kubernetes probes (app/api/health/route.ts). Liveness: the process answers.
 * Readiness: the database answers too, within a short timeout. Pure (the database check is injected)
 * so tests/health.test.ts covers it. Never returns data, errors or connection details.
 */

export type CheckResult = "ok" | "down" | "timeout";

export interface HealthReport {
  status: "ok" | "fail";
  checks: { database?: CheckResult };
}

export const READINESS_TIMEOUT_MS = 2000;

/** Runs `check`; "timeout" when it takes longer than `timeoutMs`, "down" when it throws. */
export async function runCheck(check: () => Promise<unknown>, timeoutMs = READINESS_TIMEOUT_MS): Promise<CheckResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<CheckResult>((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  try {
    return await Promise.race([check().then(() => "ok" as const, () => "down" as const), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Liveness (no checks) or readiness (the database). */
export async function healthReport(ready: boolean, checkDatabase: () => Promise<unknown>, timeoutMs = READINESS_TIMEOUT_MS): Promise<HealthReport> {
  if (!ready) return { status: "ok", checks: {} };
  const database = await runCheck(checkDatabase, timeoutMs);
  return { status: database === "ok" ? "ok" : "fail", checks: { database } };
}
