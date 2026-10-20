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
   * (the wizard still has steps), `newStepsPromptDue` once for businesses that finished the older
   * wizard (style, goals, location…), `goalsPromptDue` once for businesses that never set their goals.
   */
  setup?: { onboardingStepsLeft: number | null; newStepsPromptDue: boolean; goalsPromptDue: boolean };
}

/** One Instagram account in the account switcher (GET /api/accounts). */
export interface InstagramAccountDto {
  id: string;
  /** Null until Instagram is connected (a newly added account in its setup). */
  handle: string | null;
  name: string;
  avatarUrl: string | null;
  avatarInitials: string;
  avatarTone: MediaTone;
  connection: ConnectionStatus;
  /** Setup (onboarding) not finished yet. */
  setupInProgress: boolean;
  /** Unread notifications about this account for the signed-in user. */
  unread: number;
  active: boolean;
}

export interface InstagramAccountsDto {
  items: InstagramAccountDto[];
  /** Accounts this login has, and how many its plan allows (admin System page). */
  count: number;
  limit: number;
  canAdd: boolean;
}

/** A login remembered on this browser ("Accounts on this device", lib/server/device-logins.ts). */
export interface DeviceAccountDto {
  /** The remembered login's id (only meaningful together with this browser's device cookie). */
  id: string;
  /** Null until Instagram is connected (a new sign-up). */
  handle: string | null;
  name: string;
  avatarUrl: string | null;
  avatarInitials: string;
  avatarTone: MediaTone;
  connection: ConnectionStatus;
  setupInProgress: boolean;
  /** The login this browser is signed in with now. */
  active: boolean;
}

export interface DeviceAccountsDto {
  items: DeviceAccountDto[];
  /** How many logins one browser remembers. */
  max: number;
  canAdd: boolean;
}

/** A client's Instagram accounts as admins see them (client detail page). */
export interface AdminInstagramAccountsDto {
  items: Array<{ id: string; name: string; handle: string | null; connection: ConnectionStatus; setupInProgress: boolean; plan: PlanId }>;
  count: number;
  limit: number;
}
