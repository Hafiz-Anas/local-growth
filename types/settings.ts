/** Per-user switches for in-app notifications (lib/notifications.ts maps each type to one). */
export interface NotificationPrefs {
  newComments: boolean;
  /** Comment or DM replies waiting for approval. */
  approvalNeeded: boolean;
  weeklyReport: boolean;
  competitorAlerts: boolean;
  experimentResults: boolean;
  recommendationsReady: boolean;
  instagramReconnect: boolean;
  /** A scheduled post published or failed. */
  scheduledPosts: boolean;
  postMonitoring: boolean;
}

export interface ClientSettings {
  /** 0 = Formal Arabic, 100 = Casual Kuwaiti. */
  tone: number;
  defaultHashtags: string[];
  brandWords: string[];
  notifications: NotificationPrefs;
}
