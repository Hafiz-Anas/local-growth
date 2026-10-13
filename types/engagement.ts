import type { MediaTone } from "./client";

export interface DmRule {
  id: string;
  keywords: string[];
  /** Public reply under the comment (keyword replies). */
  reply: string;
  /** Private DM to the commenter. */
  message: string;
  timesTriggered: number;
  active: boolean;
}

export interface IncomingComment {
  id: string;
  author: string;
  authorAvatarUrl: string | null;
  authorInitials: string;
  authorTone: MediaTone;
  text: string;
  postCaption: string;
  postedAt: string;
  likes: number;
  isPriceQuestion: boolean;
  draftReply: string;
  draftLanguage: "en" | "ar";
}

export interface EngagementData {
  stats: {
    commentsToday: number;
    dmsSent: number;
  };
  rules: DmRule[];
  replyQueue: IncomingComment[];
  settings: {
    manualApproval: boolean;
    autoReply: boolean;
    priceQuestionsToWhatsapp: boolean;
  };
}
