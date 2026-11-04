import { after } from "next/server";
import { assertCronAuthorized } from "@/lib/server/cron";
import { handler, ok } from "@/lib/server/http";
import { CRON_RUN_BUDGET_MS, publishDuePosts, type PublishRunSummary } from "@/lib/server/publishing";

/**
 * A run starts new steps for CRON_RUN_BUDGET_MS (20 s) and answers by ANSWER_BY_MS (25 s) at the latest, under
 * cron-job.org's 30-second request timeout. A step already sent to Instagram then finishes after the answer
 * (after(), within maxDuration); if the function is stopped anyway, the job's lease runs out and the next
 * run takes it over, checking Instagram first. 60 s is allowed on every Vercel plan.
 */
export const maxDuration = 60;

const ANSWER_BY_MS = 25_000;

/**
 * GET /api/cron/publish — works through the publishing jobs (lib/server/publishing.ts): due posts, retries,
 * containers still processing, jobs whose run died. Meant to run every minute (DEPLOY.md: cron-job.org).
 * Called by Vercel Cron or an external scheduler with `Authorization: Bearer $CRON_SECRET`
 * (Vercel Cron sends that header itself when CRON_SECRET is set). Off until CRON_SECRET is set.
 */
export const GET = handler(async (request) => {
  assertCronAuthorized(request, "Scheduled publishing");
  const startedAt = Date.now();
  const work = publishDuePosts({ budgetMs: CRON_RUN_BUDGET_MS });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ANSWER_BY_MS);
  });
  const summary = await Promise.race([work, late]).finally(() => clearTimeout(timer));
  if (summary) {
    if (summary.due) console.info("[cron:publish]", JSON.stringify(summary));
    return ok({ ...summary, finishing: false, ms: Date.now() - startedAt });
  }
  // A step is still waiting for Instagram: answer now, let it finish in the background.
  after(() =>
    work.then(
      (s: PublishRunSummary) => console.info("[cron:publish] finished after answering", JSON.stringify(s)),
      (e) => console.error("[cron:publish] run failed after answering", (e as Error)?.message),
    ),
  );
  return ok({ finishing: true, ms: Date.now() - startedAt });
});
