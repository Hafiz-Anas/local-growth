export interface NotificationPrefs {
  newComments: boolean;
  approvalNeeded: boolean;
  weeklyReport: boolean;
  competitorAlerts: boolean;
  experimentResults: boolean;
}

export interface ClientSettings {
  /** 0 = Formal Arabic, 100 = Casual Kuwaiti. */
  tone: number;
  defaultHashtags: string[];
  brandWords: string[];
  notifications: NotificationPrefs;
}
