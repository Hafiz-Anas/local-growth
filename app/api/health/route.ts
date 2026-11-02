import { db } from "@/lib/db";
import { healthReport } from "@/lib/health";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — liveness: 200 while the server answers.
 * GET /api/health?ready=1 — readiness: also checks the database (2 s timeout); 503 when it doesn't answer.
 * Public (Kubernetes probes have no session), no rate limit, never returns data or error details.
 */
export async function GET(request: Request) {
  const ready = new URL(request.url).searchParams.has("ready");
  const report = await healthReport(ready, () => db.$queryRaw`SELECT 1`);
  return Response.json(report, { status: report.status === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
