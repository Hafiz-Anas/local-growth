import type {
  ClientSettings,
  CompetitorInsightsData,
  DashboardData,
  EngagementData,
  ExperimentData,
  PostGeneratorData,
} from "@/types";

/** Everything the mock API returns for one client, grouped by screen. */
export interface ClientDataPack {
  dashboard: DashboardData;
  competitors: CompetitorInsightsData;
  generator: PostGeneratorData;
  experiment: ExperimentData;
  engagement: EngagementData;
  settings: ClientSettings;
}
