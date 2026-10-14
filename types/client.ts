import type { PlanId } from "./permissions";

export type ConnectionStatus = "connected" | "needs_attention" | "disconnected";

export type MediaTone = "roast" | "pistachio" | "date" | "rose" | "latte" | "sand" | "night" | "berry";

/** A business account managed by the platform (one per user login). */
export interface Client {
  id: string;
  userId: string;
  businessName: string;
  businessNameAr: string;
  /** Instagram handle, or the business name while no handle is connected (see `instagramHandle`). */
  handle: string;
  /** The real handle; null for a self sign-up that hasn't connected Instagram. Omitted in mock data. */
  instagramHandle?: string | null;
  category: string;
  categoryAr: string;
  location: string;
  locationAr: string;
  /** IANA time zone used for scheduling (e.g. "Asia/Kuwait"). */
  timezone: string;
  email: string;
  plan: PlanId;
  connection: ConnectionStatus;
  connectedAt: string | null;
  lastActivityAt: string;
  followers: number;
  following: number;
  posts: number;
  bio: string;
  website: string;
  whatsappNumber: string;
  postsPublishedToday: number;
  /** Business logo / profile picture; `null` falls back to initials. */
  avatarUrl: string | null;
  avatarTone: MediaTone;
  avatarInitials: string;
  /** Which Instagram implementation serves this business (mock demo data or real Meta). */
  instagramProvider?: "mock" | "meta";
  /** Set when the connection needs the user: the token expired/was revoked, or permissions are missing. */
  instagramIssue?: { reason: "reconnect" | "permissions"; permissions: string[] } | null;
  /**
   * Set-up prompts on the dashboard: `onboardingStepsLeft` when the owner chose "Finish later"
   * (the wizard still has steps), `goalsPromptDue` once for businesses that never set their goals.
   */
  setup?: { onboardingStepsLeft: number | null; goalsPromptDue: boolean };
}
