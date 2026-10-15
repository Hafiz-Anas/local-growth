import type { Bucket, PeriodTotals, StatRange, StatisticsData, StatsPoint } from "@/lib/analysis/statistics";
import type { AiTextState } from "./analysis";

export type { Bucket, PeriodTotals, StatRange, StatisticsData, StatsPoint };

export interface StatisticsSummaryText {
  en: string;
  ar: string;
}

export interface StatisticsDto extends StatisticsData {
  connected: boolean;
  /** Mock connection: the app's sample data. */
  demo: boolean;
  /** Demo accounts: follower counts before the first stored day are sample data. */
  sampleFollowers: boolean;
  summary: AiTextState<StatisticsSummaryText>;
}
