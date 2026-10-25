"use client";

import { useMutation, useQuery, useQueryClient, type UseMutationOptions, type UseQueryResult } from "@tanstack/react-query";
import { useActiveClient } from "@/components/providers/active-client-provider";
import { useI18n } from "@/lib/i18n/provider";
import { notify } from "@/store/ui-store";
import type {
  AiStatusDto,
  AssistantOverviewDto,
  AssistantThreadDto,
  BrandProfileDto,
  BrandVoiceDto,
  CompetitorDto,
  DashboardDto,
  EngagementDto,
  EngagementRuleDto,
  ExperimentDto,
  GeneratorOptionsDto,
  InstagramConnectionDto,
  MeDto,
  NotificationPrefs,
  NotificationsDto,
  PostDraftDto,
  PreviewDto,
  RecommendationsDto,
  ReplyDraftDto,
  ReplySummaryDto,
  CompetitorAnalysisDto,
  MethodsDto,
  PostPerformanceDto,
  ShareabilityDto,
  PostDetailDto,
  MonitoringDto,
  MonitorDetailDto,
  StatisticsDto,
  StatRange,
  ScheduledPostDto,
  TrendsDto,
  WeeklyReportDto,
} from "@/types";
import type { Feeling, Target } from "@/config/onboarding";
import { apiFetch, type ApiClientError } from "./client";

/** Query keys, shared by queries, mutations and cache updates. */
export const qk = {
  /** The login's Instagram accounts (account switcher). */
  accounts: ["accounts"] as const,
  /** The logins remembered on this browser (account switcher). */
  deviceAccounts: ["device-accounts"] as const,
  me: ["me"] as const,
  dashboard: ["dashboard"] as const,
  competitors: ["competitors"] as const,
  trends: ["trends"] as const,
  generatorOptions: ["generator-options"] as const,
  drafts: ["drafts"] as const,
  scheduled: ["scheduled-posts"] as const,
  experiment: ["experiment"] as const,
  engagement: ["engagement"] as const,
  rules: ["engagement-rules"] as const,
  replies: ["reply-drafts"] as const,
  sentReplies: ["reply-drafts", "sent"] as const,
  replySummary: ["reply-drafts", "summary"] as const,
  competitorAnalysis: ["competitors", "analysis"] as const,
  methods: ["methods"] as const,
  postPerformance: ["post-performance"] as const,
  postDetail: (id: string) => ["post-performance", id] as const,
  shareability: ["shareability"] as const,
  monitoring: ["monitoring"] as const,
  monitor: (id: string) => ["monitoring", id] as const,
  statistics: (range: string) => ["statistics", range] as const,
  brandVoice: ["brand-voice"] as const,
  connection: ["instagram-connection"] as const,
  onboarding: ["onboarding"] as const,
  /** Photo style guide (onboarding "Your style", the "You're all set" screen, Settings). */
  styleGuide: ["style-guide"] as const,
  /** Settings → Business: name and location. */
  businessDetails: ["business-details"] as const,
  competitorSuggestions: ["onboarding", "competitor-suggestions"] as const,
  brand: ["brand"] as const,
  brandColors: ["brand", "colors"] as const,
  instagramMedia: ["instagram-media"] as const,
  assistant: ["assistant"] as const,
  assistantThread: (id: string) => ["assistant", "thread", id] as const,
  recommendations: ["recommendations"] as const,
  aiStatus: ["dashboard", "ai-status"] as const,
  notificationCenter: ["notification-center"] as const,
  reports: ["reports"] as const,
  goals: ["brand", "goals"] as const,
  preview: (businessId: string) => ["preview", businessId] as const,
  admin: {
    overview: ["admin", "overview"] as const,
    onboarding: ["admin", "onboarding"] as const,
    settings: ["admin", "settings"] as const,
    brand: (id: string) => ["admin", "brand", id] as const,
    businesses: ["admin", "businesses"] as const,
    business: (id: string) => ["admin", "business", id] as const,
    permissions: (id: string) => ["admin", "permissions", id] as const,
    integration: (id: string) => ["admin", "integration", id] as const,
    accounts: (id: string) => ["admin", "accounts", id] as const,
    users: (businessId?: string) => ["admin", "users", businessId ?? "all"] as const,
    activity: (businessId?: string) => ["admin", "activity", businessId ?? "all"] as const,
    system: ["admin", "system"] as const,
  },
};

type PreviewData = PreviewDto["data"];

/**
 * Data for the user-facing screens. Normally reads the user's own API; while an
 * admin previews a business it reads the same section from the read-only
 * preview API instead (one shared request for all sections).
 */
function useClientData<T>(
  key: readonly unknown[],
  path: string,
  fromPreview: (data: PreviewData) => T | undefined,
  enabled = true,
): UseQueryResult<T, ApiClientError> {
  const { client, isPreview } = useActiveClient();
  const own = useQuery<T, ApiClientError>({ queryKey: key, queryFn: () => apiFetch<T>(path), enabled: enabled && !isPreview });
  const preview = useQuery<PreviewDto, ApiClientError, T>({
    queryKey: qk.preview(client.id),
    queryFn: () => apiFetch<PreviewDto>(`/api/admin/preview/${client.id}`),
    enabled: enabled && isPreview,
    select: (d) => fromPreview(d.data) as T,
  });
  return isPreview ? preview : own;
}

/** Notification settings: the user's own (from /api/me), or the previewed business user's. */
export function useNotifications(): UseQueryResult<NotificationPrefs, ApiClientError> {
  const { client, isPreview } = useActiveClient();
  const own = useQuery<MeDto, ApiClientError, NotificationPrefs>({
    queryKey: qk.me,
    queryFn: () => apiFetch<MeDto>("/api/me"),
    enabled: !isPreview,
    select: (me) => me.user.notifications,
  });
  const preview = useQuery<PreviewDto, ApiClientError, NotificationPrefs>({
    queryKey: qk.preview(client.id),
    queryFn: () => apiFetch<PreviewDto>(`/api/admin/preview/${client.id}`),
    enabled: isPreview,
    select: (d) => d.data.notifications,
  });
  return isPreview ? preview : own;
}
export const useDashboard = (enabled = true) =>
  useClientData<DashboardDto>(qk.dashboard, "/api/dashboard", (d) => d.dashboard, enabled);
export const useCompetitors = (enabled = true) =>
  useClientData<CompetitorDto[]>(qk.competitors, "/api/competitors", (d) => d.competitors ?? [], enabled);
/**
 * One tracked competitor (detail view). Starts from the list entry when the list
 * is cached, so opening a card is instant, then loads the full record.
 */
export function useCompetitor(id: string): UseQueryResult<CompetitorDto | undefined, ApiClientError> {
  const { client, isPreview } = useActiveClient();
  const queryClient = useQueryClient();
  const own = useQuery<CompetitorDto | undefined, ApiClientError>({
    queryKey: [...qk.competitors, id],
    queryFn: () => apiFetch<CompetitorDto>(`/api/competitors/${id}`),
    enabled: !isPreview,
    initialData: () => queryClient.getQueryData<CompetitorDto[]>(qk.competitors)?.find((c) => c.id === id),
    initialDataUpdatedAt: () => queryClient.getQueryState(qk.competitors)?.dataUpdatedAt,
  });
  const preview = useQuery<PreviewDto, ApiClientError, CompetitorDto | undefined>({
    queryKey: qk.preview(client.id),
    queryFn: () => apiFetch<PreviewDto>(`/api/admin/preview/${client.id}`),
    enabled: isPreview,
    select: (d) => d.data.competitors?.find((c) => c.id === id),
  });
  return isPreview ? preview : own;
}
export const useTrends = (enabled = true) =>
  useClientData<TrendsDto>(qk.trends, "/api/competitors/trends", (d) => d.trends ?? {}, enabled);
export const useGeneratorOptions = (enabled = true) =>
  useClientData<GeneratorOptionsDto>(qk.generatorOptions, "/api/post-generator/options", (d) => d.generatorOptions, enabled);
export const useDrafts = (enabled = true) =>
  useClientData<PostDraftDto[]>(qk.drafts, "/api/post-drafts", (d) => d.drafts ?? [], enabled);
/** Pass `enabled: false` when the business has neither queue feature (the API would 404). */
export const useScheduled = (enabled = true) =>
  useClientData<ScheduledPostDto[]>(qk.scheduled, "/api/scheduled-posts", (d) => d.scheduledPosts ?? [], enabled);
export const useExperiment = (enabled = true) =>
  useClientData<ExperimentDto | null>(qk.experiment, "/api/experiment", (d) => d.experiment ?? null, enabled);
export const useEngagement = (enabled = true) =>
  useClientData<EngagementDto>(qk.engagement, "/api/engagement", (d) => d.engagement, enabled);
export const useRules = (enabled = true) =>
  useClientData<EngagementRuleDto[]>(qk.rules, "/api/engagement/rules", (d) => d.rules ?? [], enabled);
export const useReplies = (enabled = true) =>
  useClientData<ReplyDraftDto[]>(qk.replies, "/api/reply-drafts", (d) => d.replyDrafts ?? [], enabled);
/** Engagement → Sent: recent sent replies with how they went out (as drafted, edited, written by hand). */
export const useSentReplies = (enabled = true) =>
  useClientData<ReplyDraftDto[]>(qk.sentReplies, "/api/reply-drafts?status=posted", (d) => d.sentReplies ?? [], enabled);
export const useReplySummary = (enabled = true) =>
  useClientData<ReplySummaryDto | null>(qk.replySummary, "/api/reply-drafts/summary", (d) => d.replySummary ?? null, enabled);
/** Competitors → Analysis (numbers + cached AI text; the AI text is requested separately). */
export const useCompetitorAnalysis = (enabled = true) =>
  useClientData<CompetitorAnalysisDto>(qk.competitorAnalysis, "/api/competitors/analysis", (d) => d.competitorAnalysis, enabled);
export const useMethods = (enabled = true) => useClientData<MethodsDto>(qk.methods, "/api/methods", (d) => d.methods, enabled);
export const usePostPerformance = (enabled = true) => useClientData<PostPerformanceDto>(qk.postPerformance, "/api/post-performance", (d) => d.postPerformance, enabled);
export const usePostDetail = (id: string) =>
  useClientData<PostDetailDto>(qk.postDetail(id), `/api/post-performance/${encodeURIComponent(id)}`, (d) => d.postDetails?.[id]);
/** "Most shared": share rate per post, the account's average and the cached findings (requested separately). */
export const useShareability = (enabled = true) => useClientData<ShareabilityDto>(qk.shareability, "/api/shareability", (d) => d.shareability, enabled);
/** Post monitoring: monitored posts, the plan's limit, recent posts to pick from and the history. */
export const useMonitoring = (enabled = true) => useClientData<MonitoringDto>(qk.monitoring, "/api/monitoring", (d) => d.monitoring, enabled);
export const useMonitor = (id: string) => useClientData<MonitorDetailDto>(qk.monitor(id), `/api/monitoring/${encodeURIComponent(id)}`, (d) => d.monitorDetails?.[id]);
/** Statistics for one period (numbers + cached AI summary; the summary is requested separately). */
export const useStatistics = (range: StatRange) => useClientData<StatisticsDto>(qk.statistics(range), `/api/statistics?range=${range}`, (d) => d.statistics?.[range]);
export const useBrandVoice = (enabled = true) =>
  useClientData<BrandVoiceDto | null>(qk.brandVoice, "/api/brand-voice", (d) => d.brandVoice ?? null, enabled);
export const useConnection = (enabled = true) =>
  useClientData<InstagramConnectionDto>(qk.connection, "/api/instagram/connection", (d) => d.instagram, enabled);
/** Settings → Brand profile (read-only from the preview API while an admin previews). */
export const useBrandProfile = (enabled = true) => useClientData<BrandProfileDto>(qk.brand, "/api/brand", (d) => d.brand, enabled);

export type { NotificationPrefs };

/**
 * useMutation for user-screen actions. In admin preview every action is
 * read-only: it shows a note instead of calling the API.
 */
export function useAction<TData = unknown, TVars = void, TContext = unknown>(options: UseMutationOptions<TData, ApiClientError, TVars, TContext>) {
  const { isPreview } = useActiveClient();
  const { t } = useI18n();
  const mutation = useMutation<TData, ApiClientError, TVars, TContext>(options);
  if (!isPreview) return mutation;
  const blocked = () => notify.info(t("preview.readOnly"));
  return {
    ...mutation,
    mutate: blocked as typeof mutation.mutate,
    mutateAsync: (async () => {
      blocked();
      throw new Error("read-only preview");
    }) as typeof mutation.mutateAsync,
  };
}

/**
 * The AI assistant: modes, recent chats and today's allowance. Chats are the
 * business's own, so admin preview doesn't load them (the panel says so instead).
 */
export function useAssistant(): UseQueryResult<AssistantOverviewDto, ApiClientError> {
  const { isPreview } = useActiveClient();
  return useQuery<AssistantOverviewDto, ApiClientError>({ queryKey: qk.assistant, queryFn: () => apiFetch<AssistantOverviewDto>("/api/assistant"), enabled: !isPreview });
}

/** One chat's messages; `null` = a new, empty chat. */
export function useAssistantThread(id: string | null): UseQueryResult<AssistantThreadDto, ApiClientError> {
  const { isPreview } = useActiveClient();
  return useQuery<AssistantThreadDto, ApiClientError>({
    queryKey: qk.assistantThread(id ?? "new"),
    queryFn: () => apiFetch<AssistantThreadDto>(`/api/assistant/conversations/${id}`),
    enabled: Boolean(id) && !isPreview,
  });
}

/** AI strategy recommendations (not loaded in admin preview: decisions are the business's own). */
export function useRecommendations(): UseQueryResult<RecommendationsDto, ApiClientError> {
  const { isPreview } = useActiveClient();
  return useQuery<RecommendationsDto, ApiClientError>({ queryKey: qk.recommendations, queryFn: () => apiFetch<RecommendationsDto>("/api/recommendations"), enabled: !isPreview });
}

/** The dashboard's AI status card (not in admin preview). Pass `enabled: false` when no AI module is on. */
export function useAiStatus(enabled = true): UseQueryResult<AiStatusDto, ApiClientError> {
  const { isPreview } = useActiveClient();
  return useQuery<AiStatusDto, ApiClientError>({ queryKey: qk.aiStatus, queryFn: () => apiFetch<AiStatusDto>("/api/dashboard/ai-status"), enabled: enabled && !isPreview });
}

/** The notification center (bell): latest notifications and the unread count, refreshed every minute. */
export function useNotificationCenter(enabled = true): UseQueryResult<NotificationsDto, ApiClientError> {
  const { isPreview } = useActiveClient();
  return useQuery<NotificationsDto, ApiClientError>({
    queryKey: qk.notificationCenter,
    queryFn: () => apiFetch<NotificationsDto>("/api/notifications"),
    enabled: enabled && !isPreview,
    refetchInterval: 60_000,
  });
}

/** Weekly reports, newest first (not in admin preview). */
export function useReports(): UseQueryResult<WeeklyReportDto[], ApiClientError> {
  const { isPreview } = useActiveClient();
  return useQuery<WeeklyReportDto[], ApiClientError>({ queryKey: qk.reports, queryFn: () => apiFetch<WeeklyReportDto[]>("/api/reports"), enabled: !isPreview });
}

export interface GoalsDto {
  niche: string | null;
  aim: string | null;
  goals: string[];
  timeline: string | null;
  /** Onboarding's "Your goals". */
  targets: Target[];
  feelings: Feeling[];
  feelingOther: string | null;
}

/** Niche, aim, goals and timeline (Settings → Goals; not loaded in admin preview). */
export function useGoals(): UseQueryResult<GoalsDto, ApiClientError> {
  const { isPreview } = useActiveClient();
  return useQuery<GoalsDto, ApiClientError>({ queryKey: qk.goals, queryFn: () => apiFetch<GoalsDto>("/api/brand/goals"), enabled: !isPreview });
}
