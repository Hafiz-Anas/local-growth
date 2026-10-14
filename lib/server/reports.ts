import "server-only";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { isFeatureEnabled, permissionsFromRows } from "@/lib/permissions";
import { getAIService } from "@/lib/services/ai";
import { getInstagramService } from "@/lib/services/instagram";
import { computeWeeklyNumbers, formatReportNumbers } from "@/lib/services/text/report";
import type { WeeklyNumbers, WeeklyReportDto } from "@/types";
import { aiPace } from "./ai-pace";
import { gatherAssistantFacts } from "./assistant";
import { getInstagramAccount } from "./instagram-account";
import { notify } from "./notifications";

/**
 * Weekly reports: the week's numbers vs the week before, computed in code from the same
 * data the assistant uses, plus a short AI summary. When the AI is unavailable (budget,
 * outage, or a summary that quoted numbers not in the data) the report is still published,
 * with numbers only. Generated once a week per business by the daily cron.
 */

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
/** The daily cron fires at about the same time; an hour of slack keeps the weekly rhythm at 7 days, not 8. */
const CRON_SLACK = 60 * 60 * 1000;
const CRON_BATCH = Math.max(1, Number.parseInt(process.env.REPORTS_CRON_BATCH ?? "", 10) || 10);

function toDto(row: { id: string; createdAt: Date; numbers: Prisma.JsonValue; summaryEn: string | null; summaryAr: string | null }): WeeklyReportDto {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    numbers: row.numbers as unknown as WeeklyNumbers,
    summary: row.summaryEn && row.summaryAr ? { en: row.summaryEn, ar: row.summaryAr } : null,
  };
}

export async function listReports(businessId: string): Promise<WeeklyReportDto[]> {
  const rows = await db.weeklyReport.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 26, select: { id: true, createdAt: true, numbers: true, summaryEn: true, summaryAr: true } });
  return rows.map(toDto);
}

/** One report for the week ending today; "no_data" without Instagram data (nothing is stored). */
export async function generateWeeklyReport(businessId: string, { now = new Date(), pace = false } = {}): Promise<"created" | "no_data"> {
  const facts = await gatherAssistantFacts(businessId, "analytics");
  if (facts.instagram.status === "not_connected") return "no_data";
  const account = await getInstagramAccount(businessId);
  const ig = getInstagramService();
  const [insights, media] = await Promise.all([ig.getInsights(account), ig.getMedia(account, { limit: 50 })]);
  const numbers = computeWeeklyNumbers({
    posts: media.map((m) => ({ postedAt: m.postedAt, type: m.mediaType, caption: m.caption, likes: m.likes, comments: m.comments, reach: m.reach, saves: m.saves })),
    followerSeries: insights.followerSeries,
    followers: facts.profile?.followers ?? null,
    demo: facts.instagram.status === "demo",
    now,
  });

  const business = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true, nameAr: true, aim: true } });
  if (pace) await aiPace();
  const summary = await getAIService().weeklySummary({ businessId, prompt: { businessName: business.name, businessNameAr: business.nameAr, numbers: formatReportNumbers(numbers), aim: business.aim } });
  const report = await db.weeklyReport.create({
    data: {
      businessId,
      periodStart: new Date(numbers.periodStart),
      periodEnd: new Date(numbers.periodEnd),
      numbers: numbers as unknown as Prisma.InputJsonObject,
      summaryEn: summary.ok ? summary.en : null,
      summaryAr: summary.ok ? summary.ar : null,
      aiStatus: summary.ok ? "ok" : "unavailable",
    },
    select: { id: true },
  });
  await notify({ businessId, type: "weekly_report", params: { end: numbers.periodEnd }, href: `/reports#${report.id}` });
  return "created";
}

export interface ReportSweepSummary {
  due: number;
  created: number;
  noData: number;
  failed: number;
  stoppedEarly: boolean;
}

/** Daily cron: a report for each business whose last one is a week old (oldest first). */
export async function runReportSweep(deadlineMs = 120_000): Promise<ReportSweepSummary> {
  const started = Date.now();
  const summary: ReportSweepSummary = { due: 0, created: 0, noData: 0, failed: 0, stoppedEarly: false };
  const businesses = await db.business.findMany({
    where: { onboardingStatus: "COMPLETED", permissions: { some: { featureKey: "reports", enabled: true } } },
    select: { id: true, permissions: { select: { featureKey: true, enabled: true } }, weeklyReports: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } } },
  });
  const due = businesses
    .filter((b) => isFeatureEnabled(permissionsFromRows(b.permissions), "reports"))
    .map((b) => ({ id: b.id, last: b.weeklyReports[0]?.createdAt.getTime() ?? 0 }))
    .filter((b) => Date.now() - b.last >= WEEK - CRON_SLACK)
    .sort((a, b) => a.last - b.last);
  summary.due = due.length;
  let made = 0;
  for (const business of due) {
    if (made >= CRON_BATCH || Date.now() - started > deadlineMs) {
      summary.stoppedEarly = true;
      break;
    }
    try {
      const result = await generateWeeklyReport(business.id, { pace: true });
      if (result === "created") {
        summary.created += 1;
        made += 1;
      } else summary.noData += 1;
    } catch (error) {
      summary.failed += 1;
      console.error("[reports] weekly report failed", business.id, (error as Error).message);
    }
  }
  return summary;
}
